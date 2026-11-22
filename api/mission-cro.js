/**
 * api/mission-cro.js — run the CRO Lab for real, as a step of a Scotty mission.
 *
 * POST { action: 'audit', urls: [page…] (1-2), goal, businessContext?, language?,
 *        projectId?, intelProfileId?, missionId? }
 *   Reads the pages, finds conversion problems in their HTML by code, and has
 *   A/B test ideas proposed in which every test must cite an observation or a
 *   verbatim quote from the page (api/_lib/cro-audit.js). Saved as a
 *   mission_artifacts row (kind 'cro_plan', status 'pending_approval'), or
 *   'empty' when no idea survived the checks. A missing goal or page is a
 *   question back before anything is fetched or spent.
 * Header: Authorization: Bearer <the caller's own Supabase access token>
 *
 * Nothing on any website is changed and no test is started. Approving the plan
 * (api/mission-artifacts.js) adds the ideas to the CRO Lab's ICE backlog and
 * saves the audit to Report History.
 *
 * Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY.
 */

'use strict';

const { sbRest, isUuid } = require('./_lib/supabase-rest.js');
const { withFailureReporting } = require('./_lib/report-failure.js');
const { rateLimited } = require('./_lib/rate-limit.js');
const { canAccessRecord } = require('./_lib/profile-access.js');
const { crawlSite } = require('./_lib/nancy-crawl.js');
const { auditAndPropose } = require('./_lib/cro-audit.js');
const writingLanguage = require('./_lib/writing-language.js');

const MAX_PAGES = 2;

async function getCallerFromToken(supabaseUrl, serviceKey, accessToken) {
  const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return null;
  return res.json();
}

const str = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);

/** An http(s) page address with a real-looking host; '' otherwise. The path is kept: the page under test matters. */
function cleanPage(v) {
  const s = String(v || '').trim().slice(0, 300);
  if (!s) return '';
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    return /^https?:$/.test(u.protocol) && u.hostname.includes('.') ? u.toString() : '';
  } catch { return ''; }
}

module.exports = withFailureReporting('api/mission-cro', async function handler(req, res) {
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

  // Each call crawls third-party pages and spends a model generation.
  if (rateLimited(req, res, { name: 'mission-cro', max: 6, windowMs: 60 * 1000, auth: { userId: caller.id } })) return;

  const body = req.body || {};
  if (body.action !== 'audit') return res.status(400).json({ error: `Unknown action "${body.action}". Use 'audit'.` });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: 'ANTHROPIC_API_KEY is not configured, so the CRO Lab cannot propose tests.' });

  const goal = str(body.goal, 160);
  if (!goal) return res.status(400).json({ error: 'What counts as a conversion on these pages (a booking, a call, a sale…)? Tests can only be judged against a goal.', field: 'goal' });
  const urls = [...new Set((Array.isArray(body.urls) ? body.urls : []).map(cleanPage).filter(Boolean))].slice(0, MAX_PAGES);
  if (!urls.length) return res.status(400).json({ error: 'Give the CRO Lab at least one page address to audit. It will not guess which page.', field: 'urls' });

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
  // The CRO backlog and Report History list items for the active profile or project.
  if (!intelProfileId && !projectId) {
    return res.status(409).json({ error: 'No business profile or project is selected, so the CRO backlog would have nowhere to show these tests. Pick one first.', code: 'no_scope' });
  }

  // Tests already running or drafted, so the same idea isn't proposed twice.
  const ex = await sb('GET', `/experiments?user_id=eq.${caller.id}&status=in.(draft,active,paused)&select=name&limit=30`);
  const existing = ex.ok ? (ex.data || []).map(e => str(e.name, 80)).filter(Boolean) : [];

  const sites = []; const unreadable = [];
  for (const url of urls) {
    try {
      const c = await crawlSite(url);
      sites.push({ url, html: c.homepageHtml || '', pages: (c.pages || []).slice(0, 3) });
    } catch (e) { unreadable.push({ url, error: e.message }); }
  }
  if (!sites.length) {
    return res.status(422).json({ error: `None of the pages could be read: ${unreadable.map(u => `${u.url} — ${u.error}`).join('; ')}`, unreadable });
  }

  let result;
  try {
    result = await auditAndPropose(sites, { goal, existing, language: writingLanguage.isSupported(body.language) ? body.language : '', businessContext: body.businessContext });
  } catch (e) {
    return res.status(502).json({ error: `The CRO Lab could not propose tests: ${e.message}` });
  }

  const empty = result.ideas.length === 0;
  const created = await sb('POST', '/mission_artifacts', {
    user_id: caller.id, intel_profile_id: intelProfileId,
    mission_id: body.missionId ? String(body.missionId).slice(0, 80) : null,
    agent_key: 'cro', kind: 'cro_plan', title: `CRO plan — ${sites.map(s => new URL(s.url).hostname.replace(/^www\./, '')).join(', ').slice(0, 80)}`,
    payload: { params: { urls, goal, language: writingLanguage.isSupported(body.language) ? body.language : '', projectId }, ideas: result.ideas, observations: result.observations, unreadable, alreadyTesting: existing, droppedUnverified: result.droppedUnverified, droppedForeignFigures: result.droppedForeignFigures },
    status: empty ? 'empty' : 'pending_approval',
  });
  if (!created.ok) {
    return res.status(created.status === 404 ? 503 : 500).json(created.status === 404
      ? { code: 'not_installed', error: 'Mission artifacts are not installed. Run supabase-mission-artifacts.sql in the Supabase SQL editor.' }
      : { code: 'db_error', error: `Database error (HTTP ${created.status}).` });
  }
  const artifact = created.data && created.data[0];
  return res.json({
    ok: true, artifactId: artifact.id, status: artifact.status, ideas: result.ideas, observations: result.observations,
    unreadable, alreadyTesting: existing, droppedUnverified: result.droppedUnverified, droppedForeignFigures: result.droppedForeignFigures,
    note: empty ? 'No test idea survived the checks: none could be tied to something actually on the page without forecasting a result.' : undefined,
  });
});

module.exports.cleanPage = cleanPage;
