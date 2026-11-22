/**
 * api/mission-linkedin.js — run LinkedIn Outreach for real, as a step of a
 * Scotty mission.
 *
 * POST { action: 'draft', prospects: [{ clientId?, name, title?, company?, note?, linkedinUrl? }] (1-10),
 *        offer, senderName, senderTitle?, companyName?, language?,
 *        projectId?, intelProfileId?, missionId? }
 *   Writes a connection note and a follow-up for each person from ONLY the
 *   facts supplied, checks every draft by code (api/_lib/linkedin-drafts.js),
 *   and saves them as a mission_artifacts row (kind 'linkedin_drafts', status
 *   'pending_approval', or 'empty' when no draft passed). A missing offer,
 *   sender or person is a question back before any model call.
 * Header: Authorization: Bearer <the caller's own Supabase access token>
 *
 * Nothing touches LinkedIn: no profile is fetched, nothing is sent. LinkedIn's
 * terms forbid automated connection requests and messages, so these are drafts
 * for the person to review and send by hand. Approving
 * (api/mission-artifacts.js) records that decision; the browser then files the
 * approved drafts against the prospects on the LinkedIn Outreach page.
 *
 * Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY.
 */

'use strict';

const { sbRest, isUuid } = require('./_lib/supabase-rest.js');
const { withFailureReporting } = require('./_lib/report-failure.js');
const { rateLimited } = require('./_lib/rate-limit.js');
const { canAccessRecord } = require('./_lib/profile-access.js');
const { buildDrafts, MAX_PROSPECTS } = require('./_lib/linkedin-drafts.js');
const writingLanguage = require('./_lib/writing-language.js');

async function getCallerFromToken(supabaseUrl, serviceKey, accessToken) {
  const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return null;
  return res.json();
}

const str = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);
/** Only a real LinkedIn profile address is kept — it is shown, never fetched. */
const profileUrl = (v) => { try { const u = new URL(String(v || '').trim()); return /^https:$/.test(u.protocol) && /(^|\.)linkedin\.com$/i.test(u.hostname) && /^\/in\//i.test(u.pathname) ? u.origin + u.pathname : ''; } catch { return ''; } };

module.exports = withFailureReporting('api/mission-linkedin', async function handler(req, res) {
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

  if (rateLimited(req, res, { name: 'mission-linkedin', max: 6, windowMs: 60 * 1000, auth: { userId: caller.id } })) return;

  const body = req.body || {};
  if (body.action !== 'draft') return res.status(400).json({ error: `Unknown action "${body.action}". Use 'draft'.` });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: 'ANTHROPIC_API_KEY is not configured, so LinkedIn Outreach cannot write.' });

  // Questions first, before anything is spent.
  const questions = [];
  const offer = str(body.offer, 400);
  const senderName = str(body.senderName, 80);
  if (!offer) questions.push({ field: 'offer', question: 'What are you offering these people? The follow-up can only say what you tell it.' });
  if (!senderName) questions.push({ field: 'sender', question: 'Who is sending these? Add at least one contact person under "Contact People" in your Business Brain so the messages are written by a real name.' });
  const prospects = (Array.isArray(body.prospects) ? body.prospects : [])
    .map(p => ({ clientId: p && p.clientId != null ? str(p.clientId, 60) : '', name: str(p && p.name, 80), title: str(p && p.title, 100), company: str(p && p.company, 100), note: str(p && p.note, 400), linkedinUrl: profileUrl(p && p.linkedinUrl) }))
    .filter(p => p.name).slice(0, MAX_PROSPECTS);
  if (!prospects.length) questions.push({ field: 'prospects', question: 'Who should the messages be for? List at least one person (name, and ideally their title and company). LinkedIn Outreach will not search LinkedIn for people.' });
  if (questions.length) return res.json({ ok: true, status: 'needs_input', questions });

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
    return res.status(409).json({ error: 'No business profile or project is selected, so these drafts would have nowhere to be kept. Pick one first.', code: 'no_scope' });
  }

  const language = writingLanguage.isSupported(body.language) ? body.language : '';
  const seller = { name: senderName, title: str(body.senderTitle, 80) || null, company: str(body.companyName, 120) || null, offer };
  // Ids the model sees are ours; the browser's own ids are carried alongside.
  const withIds = prospects.map((p, i) => ({ ...p, id: `p${i + 1}` }));

  let built;
  try {
    built = await buildDrafts(withIds, seller, { language });
  } catch (e) {
    return res.status(502).json({ error: `LinkedIn Outreach could not write the drafts: ${e.message}` });
  }
  const drafts = built.drafts.map((d, i) => ({ ...d, clientId: withIds[i].clientId || null, note: withIds[i].note || '' }));
  const usable = drafts.filter(d => d.usable).length;

  const created = await sb('POST', '/mission_artifacts', {
    user_id: caller.id, intel_profile_id: intelProfileId,
    mission_id: body.missionId ? String(body.missionId).slice(0, 80) : null,
    agent_key: 'linkedin', kind: 'linkedin_drafts', title: `LinkedIn outreach — ${drafts.length} ${drafts.length === 1 ? 'person' : 'people'}`,
    payload: { params: { offer, sender: seller, language, projectId }, drafts },
    status: usable ? 'pending_approval' : 'empty',
  });
  if (!created.ok) {
    return res.status(created.status === 404 ? 503 : 500).json(created.status === 404
      ? { code: 'not_installed', error: 'Mission artifacts are not installed. Run supabase-mission-artifacts.sql in the Supabase SQL editor.' }
      : { code: 'db_error', error: `Database error (HTTP ${created.status}).` });
  }
  const artifact = created.data && created.data[0];
  return res.json({
    ok: true, status: artifact.status === 'empty' ? 'empty' : 'drafted', artifactId: artifact.id, drafts, usable,
    note: usable ? undefined : 'None of the drafts passed the checks, so there is nothing to approve.',
  });
});

module.exports.profileUrl = profileUrl;
