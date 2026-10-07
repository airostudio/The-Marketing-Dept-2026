/**
 * api/mission-compliance.js — run Compliance Guard for real, as a step of a
 * Scotty mission: screen what the mission's other agents actually produced
 * before anyone approves it.
 *
 * POST { action: 'review', missionId?, content?, region?, industry?, neverSay?, competitorNames?,
 *        projectId?, intelProfileId? }
 *   Finds this mission's outputs still waiting for approval (Pat's email,
 *   social posts, Nancy's week, ad copy, SEO articles, LinkedIn drafts, a
 *   video clip) plus any content the person pasted, and screens each piece
 *   (api/_lib/compliance-screen.js): code rules, then a Claude review whose
 *   every finding must quote words that are really there. Saves the result as
 *   a mission_artifacts row (kind 'compliance_review', 'pending_approval'), and
 *   marks each screened output with its verdict, so an output with a critical
 *   finding cannot be approved without someone confirming they have read it.
 *   Nothing to screen is a question back before any model call.
 * Header: Authorization: Bearer <the caller's own Supabase access token>
 *
 * Changes no content, sends nothing, approves nothing. This is a screen, not
 * legal advice. Approving the review (api/mission-artifacts.js) saves it to
 * Report History.
 *
 * Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY.
 */

'use strict';

const { sbRest, isUuid } = require('./_lib/supabase-rest.js');
const { withFailureReporting } = require('./_lib/report-failure.js');
const { rateLimited } = require('./_lib/rate-limit.js');
const { canAccessRecord } = require('./_lib/profile-access.js');
const { screen, extractPieces, REVIEWABLE_KINDS, REGIONS } = require('./_lib/compliance-screen.js');

async function getCallerFromToken(supabaseUrl, serviceKey, accessToken) {
  const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return null;
  return res.json();
}

const str = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);
const list = (v, n, each) => [...new Set((Array.isArray(v) ? v : String(v || '').split(/[\n,]/)).map(x => str(x, each)).filter(x => x.length >= 3))].slice(0, n);
const MISSION_ID_RE = /^[A-Za-z0-9_-]{1,80}$/;

function tableError(r) {
  return r.status === 404
    ? { code: 'not_installed', error: 'Mission artifacts are not installed. Run supabase-mission-artifacts.sql in the Supabase SQL editor.' }
    : { code: 'db_error', error: `Database error (HTTP ${r.status}).` };
}

/** The mark an output carries: enough for the approve gate and the page, no more. */
function stampFor(reviewId, artifactId, result) {
  const mine = result.findings.filter(f => f.pieceId.startsWith(artifactId + ':'));
  const crit = mine.filter(f => f.severity === 'critical');
  const verdict = crit.length ? 'needs_changes' : mine.some(f => f.severity === 'warning') ? 'check_warnings' : (result.reviewError ? 'rules_only' : 'no_issues_found');
  return {
    reviewId, verdict, critical: crit.length, warnings: mine.filter(f => f.severity === 'warning').length,
    top: crit.slice(0, 5).map(f => ({ quote: f.quote.slice(0, 200), issue: f.issue.slice(0, 300) })),
    at: new Date().toISOString(),
  };
}

module.exports = withFailureReporting('api/mission-compliance', async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return res.status(500).json({ error: 'SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not configured.' });

  const accessToken = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
  if (!accessToken) return res.status(401).json({ error: 'Missing Authorization header.' });
  const caller = await getCallerFromToken(supabaseUrl, serviceKey, accessToken);
  if (!caller?.id) return res.status(401).json({ error: 'Invalid or expired session.' });

  if (rateLimited(req, res, { name: 'mission-compliance', max: 6, windowMs: 60 * 1000, auth: { userId: caller.id } })) return;

  const body = req.body || {};
  if (body.action !== 'review') return res.status(400).json({ error: `Unknown action "${body.action}". Use 'review'.` });

  const sb = (m, p, b) => sbRest(supabaseUrl, serviceKey, m, p, b);
  let intelProfileId = null;
  if (body.intelProfileId) {
    if (!isUuid(body.intelProfileId)) return res.status(400).json({ error: 'intelProfileId is not a valid id.' });
    const allowed = await canAccessRecord(supabaseUrl, serviceKey, caller.id,
      { user_id: null, intel_profile_id: body.intelProfileId }, { requireEdit: true });
    if (!allowed) return res.status(403).json({ error: 'You do not have edit access to that business profile.' });
    intelProfileId = body.intelProfileId;
  }
  let projectId = null;
  if (body.projectId) {
    if (!isUuid(body.projectId)) return res.status(400).json({ error: 'projectId is not a valid id.' });
    const pr = await sb('GET', `/projects?id=eq.${body.projectId}&user_id=eq.${caller.id}&select=id&limit=1`);
    if (pr.ok && pr.data && pr.data[0]) projectId = pr.data[0].id;
  }
  if (!intelProfileId && !projectId) {
    return res.status(409).json({ error: 'No business profile or project is selected, so this review would have nowhere to be kept. Pick one first.', code: 'no_scope' });
  }

  // What to screen: this mission's outputs awaiting approval, plus anything pasted.
  const missionId = body.missionId && MISSION_ID_RE.test(String(body.missionId)) ? String(body.missionId) : null;
  const outputs = [];
  if (missionId) {
    const r = await sb('GET', `/mission_artifacts?mission_id=eq.${missionId}&status=eq.pending_approval&kind=in.(${REVIEWABLE_KINDS.join(',')})&select=*&order=created_at.asc&limit=50`);
    if (!r.ok) return res.status(r.status === 404 ? 503 : 500).json(tableError(r));
    for (const a of r.data || []) {
      // Only what this person could approve themselves is screened and marked.
      if (await canAccessRecord(supabaseUrl, serviceKey, caller.id, a, { requireEdit: true })) outputs.push(a);
    }
  }
  const pieces = outputs.flatMap(extractPieces);
  const pasted = String(body.content || '').replace(/\r\n?/g, '\n').trim().slice(0, 12000);
  if (pasted) pieces.push({ id: 'pasted:content', artifactId: null, kind: 'pasted', label: 'Pasted content', channel: 'other', text: pasted, meta: null });
  if (!pieces.length) {
    return res.json({ ok: true, status: 'needs_input', questions: [{ field: 'content', question: 'There is nothing to screen yet: this mission has produced nothing that is waiting for approval. Paste the content you want checked, or run the step after the other agents have finished.' }] });
  }
  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: 'ANTHROPIC_API_KEY is not configured, so Compliance Guard cannot review.' });

  const region = REGIONS.includes(body.region) ? body.region : 'Global';
  const ctx = {
    region, industry: str(body.industry, 120),
    neverSay: list(body.neverSay, 40, 120), competitorNames: list(body.competitorNames, 20, 80),
  };
  const result = await screen(pieces, ctx);

  const reviewed = outputs.filter(a => result.pieces.some(p => p.artifactId === a.id));
  const counts = { critical: result.findings.filter(f => f.severity === 'critical').length, warnings: result.findings.filter(f => f.severity === 'warning').length, suggestions: result.findings.filter(f => f.severity === 'suggestion').length };
  const created = await sb('POST', '/mission_artifacts', {
    user_id: caller.id, intel_profile_id: intelProfileId, mission_id: missionId,
    agent_key: 'compliance', kind: 'compliance_review',
    title: `Compliance screen — ${reviewed.length ? `${reviewed.length} output${reviewed.length === 1 ? '' : 's'}` : 'pasted content'}${pasted && reviewed.length ? ' + pasted content' : ''}`,
    payload: {
      params: { region, industry: ctx.industry, projectId }, counts,
      reviewed: reviewed.map(a => ({ artifactId: a.id, kind: a.kind, title: a.title })),
      pieces: result.pieces, skippedPieces: result.skippedPieces, findings: result.findings,
      droppedUnverified: result.droppedUnverified, reviewError: result.reviewError,
      notLegalAdvice: true,
    },
    status: 'pending_approval',
  });
  if (!created.ok) return res.status(created.status === 404 ? 503 : 500).json(tableError(created));
  const review = created.data && created.data[0];

  // Mark each screened output. Conditional on nobody having changed it since it was read.
  const unmarked = [];
  for (const a of reviewed) {
    const stamp = stampFor(review.id, a.id, result);
    const upd = await sb('PATCH', `/mission_artifacts?id=eq.${a.id}&status=eq.pending_approval&updated_at=eq.${encodeURIComponent(a.updated_at)}`, {
      payload: { ...(a.payload || {}), compliance: stamp }, updated_at: new Date().toISOString(),
    });
    if (!upd.ok || !Array.isArray(upd.data) || !upd.data.length) unmarked.push(a.id);
  }

  return res.json({
    ok: true, status: 'reviewed', artifactId: review.id, region, counts,
    pieces: result.pieces, findings: result.findings, skippedPieces: result.skippedPieces,
    droppedUnverified: result.droppedUnverified, reviewError: result.reviewError,
    reviewed: reviewed.map(a => ({ artifactId: a.id, kind: a.kind, title: a.title, verdict: stampFor(review.id, a.id, result).verdict })),
    unmarked,
  });
});

module.exports.stampFor = stampFor;
