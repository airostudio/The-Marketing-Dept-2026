/**
 * api/mission-pat.js — run Pat's drafting step for real, as part of a
 * Scotty mission.
 *
 * POST { action: 'draft', offer, ctaUrl?, audience?, audienceTags?, senderName?,
 *        companyName?, businessContext?, expectedRecipients?, intelProfileId?, missionId? }
 * Header: Authorization: Bearer <the caller's own Supabase access token>
 *
 * Drafts one outreach email, runs it through the same gates a send goes
 * through plus Scotty's QA review (api/_lib/pat-pipeline.js), and saves the
 * result as a mission_artifacts row (kind 'pat_campaign', status
 * 'pending_approval'). If the offer or sender is missing it answers with
 * questions and creates nothing — no model call, no row.
 *
 * Nothing is sent from here. Approving the artifact (api/mission-artifacts.js)
 * records the human OK and prepares the audience; the person then sends from
 * Pat's own page, behind suppression, quota and the compliance footer.
 *
 * Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY.
 */

'use strict';

const { sbRest, isUuid } = require('./_lib/supabase-rest.js');
const { withFailureReporting } = require('./_lib/report-failure.js');
const { rateLimited } = require('./_lib/rate-limit.js');
const { canAccessRecord } = require('./_lib/profile-access.js');
const { buildCampaign } = require('./_lib/pat-pipeline.js');

async function getCallerFromToken(supabaseUrl, serviceKey, accessToken) {
  const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return null;
  return res.json();
}

const clean = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);

/** Tags are lowercase slugs, same shape Blade's import writes. */
function cleanTags(v) {
  const list = Array.isArray(v) ? v : [];
  return [...new Set(list.map(t => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)).filter(Boolean))].slice(0, 5);
}

/** Only an http(s) URL may become the email's link. */
function cleanUrl(v) {
  const s = clean(v, 500);
  if (!s) return '';
  try { const u = new URL(s); return /^https?:$/.test(u.protocol) ? u.toString() : ''; } catch { return ''; }
}

module.exports = withFailureReporting('api/mission-pat', async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: 'SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not configured.' });
  }

  const accessToken = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
  if (!accessToken) return res.status(401).json({ error: 'Missing Authorization header.' });
  const caller = await getCallerFromToken(supabaseUrl, serviceKey, accessToken);
  if (!caller?.id) return res.status(401).json({ error: 'Invalid or expired session.' });

  // Drafting and reviewing spend model credits on the account.
  if (rateLimited(req, res, { name: 'mission-pat', max: 10, windowMs: 60 * 1000, auth: { userId: caller.id } })) return;

  const body = req.body || {};
  if (body.action !== 'draft') return res.status(400).json({ error: `Unknown action "${body.action}". Use 'draft'.` });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: 'ANTHROPIC_API_KEY is not configured, so Pat cannot draft.' });

  let intelProfileId = null;
  if (body.intelProfileId) {
    if (!isUuid(body.intelProfileId)) return res.status(400).json({ error: 'intelProfileId is not a valid id.' });
    const allowed = await canAccessRecord(supabaseUrl, serviceKey, caller.id,
      { user_id: null, intel_profile_id: body.intelProfileId }, { requireEdit: true });
    if (!allowed) return res.status(403).json({ error: 'You do not have edit access to that business profile.' });
    intelProfileId = body.intelProfileId;
  }

  const input = {
    offer: clean(body.offer, 600),
    ctaUrl: cleanUrl(body.ctaUrl),
    audience: clean(body.audience, 200),
    senderName: clean(body.senderName, 80),
    companyName: clean(body.companyName, 120),
    businessContext: clean(body.businessContext, 1200),
    expectedRecipients: Math.max(0, Math.min(5000, parseInt(body.expectedRecipients, 10) || 0)),
  };
  const audienceTags = cleanTags(body.audienceTags);

  let built;
  try {
    built = await buildCampaign({ ...input, campaignName: 'Scotty mission outreach' });
  } catch (e) {
    return res.status(502).json({ error: `Pat could not draft the email: ${e.message}` });
  }
  if (built.status === 'needs_input') return res.json({ ok: true, status: 'needs_input', questions: built.questions });

  const sb = (m, p, b) => sbRest(supabaseUrl, serviceKey, m, p, b);
  const created = await sb('POST', '/mission_artifacts', {
    user_id: caller.id,
    intel_profile_id: intelProfileId,
    mission_id: body.missionId ? String(body.missionId).slice(0, 80) : null,
    agent_key: 'delivery',
    kind: 'pat_campaign',
    title: built.subject.slice(0, 120),
    payload: {
      params: { ...input, audienceTags },
      subject: built.subject, html: built.html, text: built.text,
      review: built.review, fixed: built.fixed, questions: built.questions,
    },
    status: 'pending_approval',
  });
  if (!created.ok) {
    return res.status(created.status === 404 ? 503 : 500).json(created.status === 404
      ? { code: 'not_installed', error: 'Mission artifacts are not installed. Run supabase-mission-artifacts.sql in the Supabase SQL editor.' }
      : { code: 'db_error', error: `Database error (HTTP ${created.status}).` });
  }
  const artifact = created.data && created.data[0];

  return res.json({
    ok: true, status: 'drafted', artifactId: artifact.id,
    subject: built.subject, html: built.html, text: built.text, preview: built.preview, review: built.review, fixed: built.fixed, questions: built.questions,
  });
});
