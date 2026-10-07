/**
 * api/mission-analytics.js — run Analytics Brain for real, as a step of a
 * Scotty mission.
 *
 * POST { action: 'report', periodDays?: 7|30|90, focus?, businessContext?, language?,
 *        projectId?, intelProfileId?, missionId? }
 *   Gathers the account's real numbers (email, revenue, audience, flows,
 *   social posts — api/_lib/analytics-facts.js), has a report written from
 *   ONLY those facts, and checks every figure in it against them
 *   (api/_lib/analytics-report.js). Saved as a mission_artifacts row (kind
 *   'analytics_report', status 'pending_approval'). A report containing a
 *   figure that is not in the data is saved with review.approved=false and
 *   cannot be approved.
 * Header: Authorization: Bearer <the caller's own Supabase access token>
 *
 * Nothing is published or sent. Approving the report
 * (api/mission-artifacts.js) saves it to Report History on the Analytics page.
 *
 * Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY.
 */

'use strict';

const { sbRest, isUuid } = require('./_lib/supabase-rest.js');
const { withFailureReporting } = require('./_lib/report-failure.js');
const { rateLimited } = require('./_lib/rate-limit.js');
const { canAccessRecord } = require('./_lib/profile-access.js');
const { gatherFacts, PERIODS } = require('./_lib/analytics-facts.js');
const { buildReport } = require('./_lib/analytics-report.js');
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

module.exports = withFailureReporting('api/mission-analytics', async function handler(req, res) {
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

  // Each call reads the account's data and spends one or two model generations.
  if (rateLimited(req, res, { name: 'mission-analytics', max: 4, windowMs: 60 * 1000, auth: { userId: caller.id } })) return;

  const body = req.body || {};
  if (body.action !== 'report') return res.status(400).json({ error: `Unknown action "${body.action}". Use 'report'.` });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: 'ANTHROPIC_API_KEY is not configured, so Analytics Brain cannot write the report.' });

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
  // Report History lists reports for the active profile or project.
  if (!intelProfileId && !projectId) {
    return res.status(409).json({ error: 'No business profile or project is selected, so Report History would have nowhere to show this report. Pick one first.', code: 'no_scope' });
  }

  const periodDays = PERIODS.includes(Number(body.periodDays)) ? Number(body.periodDays) : 30;
  const language = writingLanguage.isSupported(body.language) ? body.language : '';

  let facts;
  try {
    facts = await gatherFacts(sb, { supabaseUrl, serviceKey, userId: caller.id, periodDays });
  } catch (e) {
    return res.status(502).json({ error: `Could not read your marketing data: ${e.message}` });
  }
  // A report about nothing is not worth a model call or an approval click.
  const anyData = (facts.email.available && (facts.email.campaignsSent > 0)) ||
    (facts.audience.available && facts.audience.totalContacts > 0) ||
    (facts.social.available && (facts.social.postsCreated > 0 || facts.social.published > 0)) ||
    (facts.flows.available && facts.flows.count > 0) ||
    (facts.revenue.available && facts.revenue.orders > 0);
  if (!anyData) {
    return res.json({ ok: true, status: 'no_data', facts, note: `There is no marketing activity on record for ${facts.period.label} (no emails sent, posts, flows, orders or contacts), so there is nothing to report on.` });
  }

  let built;
  try {
    built = await buildReport(facts, { focus: str(body.focus, 300), language, businessContext: body.businessContext });
  } catch (e) {
    return res.status(502).json({ error: `Analytics Brain could not write the report: ${e.message}` });
  }

  const created = await sb('POST', '/mission_artifacts', {
    user_id: caller.id, intel_profile_id: intelProfileId,
    mission_id: body.missionId ? String(body.missionId).slice(0, 80) : null,
    agent_key: 'analytics', kind: 'analytics_report', title: built.title,
    payload: { params: { periodDays, focus: str(body.focus, 300), language, projectId }, facts, markdown: built.markdown, review: built.review },
    status: 'pending_approval',
  });
  if (!created.ok) {
    return res.status(created.status === 404 ? 503 : 500).json(created.status === 404
      ? { code: 'not_installed', error: 'Mission artifacts are not installed. Run supabase-mission-artifacts.sql in the Supabase SQL editor.' }
      : { code: 'db_error', error: `Database error (HTTP ${created.status}).` });
  }
  const artifact = created.data && created.data[0];
  return res.json({ ok: true, status: 'drafted', artifactId: artifact.id, title: built.title, markdown: built.markdown, review: built.review, unavailable: facts.unavailable, period: facts.period });
});
