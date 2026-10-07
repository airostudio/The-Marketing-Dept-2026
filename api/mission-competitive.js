/**
 * api/mission-competitive.js — run Scout (Competitive Intelligence) for real,
 * as a step of a Scotty mission.
 *
 * POST { action: 'start', competitors: [url…], businessContext?, language?, projectId?, intelProfileId?, missionId? }
 *   Opens a mission_artifacts row (kind 'competitive_report', status
 *   'building') listing the competitor sites to read (at most 5). Nothing is
 *   fetched yet.
 * POST { action: 'analyze', artifactId }
 *   Reads the NEXT competitor's public pages and extracts a battlecard in which
 *   every finding is backed by a quote that is verified to be on the page
 *   (api/_lib/competitor-analysis.js). One competitor per request — a crawl
 *   and a model call each. A site that cannot be read is recorded as such.
 * POST { action: 'finish', artifactId, seoMetrics? }
 *   Once every site is done: writes the cross-competitor read from the
 *   verified findings only, with every figure checked against them
 *   (api/_lib/competitor-report.js), and flips the artifact to
 *   'pending_approval' (or 'empty' if no site could be read).
 * Header: Authorization: Bearer <the caller's own Supabase access token>
 *
 * Nothing is contacted or changed on the competitors' side beyond fetching
 * their public pages. Approving (api/mission-artifacts.js) saves the report to
 * Report History and starts daily change-watching on the competitors.
 *
 * Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY.
 */

'use strict';

const { sbRest, isUuid } = require('./_lib/supabase-rest.js');
const { withFailureReporting } = require('./_lib/report-failure.js');
const { rateLimited } = require('./_lib/rate-limit.js');
const { canAccessRecord } = require('./_lib/profile-access.js');
const { analyzeCompetitor, hostOf } = require('./_lib/competitor-analysis.js');
const { buildCompetitorReport } = require('./_lib/competitor-report.js');
const writingLanguage = require('./_lib/writing-language.js');

const MAX_COMPETITORS = 5;

async function getCallerFromToken(supabaseUrl, serviceKey, accessToken) {
  const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return null;
  return res.json();
}

function tableError(res) {
  if (res.status === 404) return { code: 'not_installed', error: 'Mission artifacts are not installed. Run supabase-mission-artifacts.sql in the Supabase SQL editor.' };
  return { code: 'db_error', error: `Database error (HTTP ${res.status}).` };
}

/** An http(s) URL with a real-looking host, normalised; '' otherwise. */
function cleanUrl(v) {
  const s = String(v || '').trim().slice(0, 300);
  if (!s) return '';
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    return /^https?:$/.test(u.protocol) && u.hostname.includes('.') ? u.origin : '';
  } catch { return ''; }
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Only numeric search data, matched to a competitor by host. Anything else in the payload is ignored. */
function cleanSeoMetrics(metrics, profiles) {
  const out = {};
  if (!metrics || typeof metrics !== 'object') return out;
  const byHost = {};
  Object.entries(metrics).forEach(([k, v]) => { if (v && typeof v === 'object') byHost[String(k).replace(/^www\./, '').toLowerCase()] = v; });
  for (const p of profiles) {
    const m = byHost[hostOf(p.url).toLowerCase()];
    if (!m) continue;
    const b = m.backlinks || {};
    const keywords = (Array.isArray(m.keywords) ? m.keywords : []).slice(0, 8).map(k => ({
      keyword: String(k && k.keyword || '').slice(0, 100), position: num(k && k.position), searchVol: num(k && k.searchVol), difficulty: num(k && k.difficulty),
    })).filter(k => k.keyword);
    const clean = { rank: num(b.rank), backlinks: num(b.backlinks), refDomains: num(b.refDomains), spamScore: num(b.spamScore), keywords };
    if (clean.rank !== null || clean.backlinks !== null || clean.refDomains !== null || keywords.length) out[p.url] = clean;
  }
  return out;
}

module.exports = withFailureReporting('api/mission-competitive', async function handler(req, res) {
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

  // Every analyze crawls a third-party site and spends a model call.
  if (rateLimited(req, res, { name: 'mission-competitive', max: 20, windowMs: 60 * 1000, auth: { userId: caller.id } })) return;

  const sb = (m, p, b) => sbRest(supabaseUrl, serviceKey, m, p, b);
  const body = req.body || {};

  try {
    /* ── start ────────────────────────────────────────────────────────── */
    if (body.action === 'start') {
      if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: 'ANTHROPIC_API_KEY is not configured, so Scout cannot analyse the competitors.' });
      const seen = new Set(); const profiles = [];
      for (const u of Array.isArray(body.competitors) ? body.competitors : []) {
        const url = cleanUrl(u);
        if (!url) continue;
        const host = hostOf(url);
        if (seen.has(host)) continue;
        seen.add(host);
        profiles.push({ name: host, url, analyzed: false });
        if (profiles.length >= MAX_COMPETITORS) break;
      }
      if (!profiles.length) return res.status(400).json({ error: 'Give Scout at least one competitor website to read. It will not guess who your competitors are.', field: 'competitors' });

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
        return res.status(409).json({ error: 'No business profile or project is selected, so Report History would have nowhere to show this report. Pick one first.', code: 'no_scope' });
      }

      const created = await sb('POST', '/mission_artifacts', {
        user_id: caller.id, intel_profile_id: intelProfileId,
        mission_id: body.missionId ? String(body.missionId).slice(0, 80) : null,
        agent_key: 'competitive', kind: 'competitive_report',
        title: `Competitive report — ${profiles.map(p => p.name).join(', ').slice(0, 80)}`,
        payload: {
          params: { language: writingLanguage.isSupported(body.language) ? body.language : '', projectId },
          businessContext: String(body.businessContext || '').slice(0, 2500), profiles, seo: {},
        },
        status: 'building',
      });
      if (!created.ok) return res.status(created.status === 404 ? 503 : 500).json(tableError(created));
      const artifact = created.data && created.data[0];
      return res.json({ ok: true, artifactId: artifact.id, status: 'building', competitors: profiles.map(p => ({ name: p.name, url: p.url })), remaining: profiles.length });
    }

    /* ── analyze / finish: load the artifact ─────────────────────────── */
    if (body.action === 'analyze' || body.action === 'finish') {
      if (!body.artifactId || !isUuid(body.artifactId)) return res.status(400).json({ error: 'artifactId is required.' });
      const r = await sb('GET', `/mission_artifacts?id=eq.${body.artifactId}&limit=1`);
      if (!r.ok) return res.status(r.status === 404 ? 503 : 500).json(tableError(r));
      const artifact = r.data && r.data[0];
      const allowed = artifact && artifact.kind === 'competitive_report'
        && await canAccessRecord(supabaseUrl, serviceKey, caller.id, artifact, { requireEdit: true });
      if (!allowed) return res.status(404).json({ error: 'Artifact not found.' });
      if (artifact.status !== 'building') return res.status(409).json({ error: `This report is already ${artifact.status.replace('_', ' ')} — it is no longer being built.` });
      const payload = artifact.payload || {};
      const profiles = Array.isArray(payload.profiles) ? payload.profiles : [];
      const save = (patch) => sb('PATCH', `/mission_artifacts?id=eq.${artifact.id}&updated_at=eq.${encodeURIComponent(artifact.updated_at)}`, { ...patch, updated_at: new Date().toISOString() });

      if (body.action === 'analyze') {
        const idx = profiles.findIndex(p => !p.analyzed);
        if (idx < 0) return res.json({ ok: true, artifactId: artifact.id, processed: 0, remaining: 0 });
        profiles[idx] = await analyzeCompetitor(profiles[idx]);
        const upd = await save({ payload: { ...payload, profiles } });
        if (!upd.ok) return res.status(500).json({ error: 'Could not save the analysis.' });
        if (!Array.isArray(upd.data) || !upd.data.length) return res.status(409).json({ error: 'This report changed while saving — try again.', code: 'conflict' });
        const p = profiles[idx];
        return res.json({ ok: true, artifactId: artifact.id, processed: 1, remaining: profiles.filter(x => !x.analyzed).length, competitor: { name: p.name, url: p.url, error: p.error, findings: p.error ? 0 : (p.offers.length + p.pricing.length + p.audiences.length + p.proofPoints.length + p.callsToAction.length + (p.positioning ? 1 : 0)), droppedUnverified: p.droppedUnverified || 0 } });
      }

      // finish
      if (profiles.some(p => !p.analyzed)) return res.status(409).json({ error: 'Some competitors have not been read yet.', code: 'not_ready' });
      const readable = profiles.filter(p => !p.error);
      if (!readable.length) {
        const upd = await save({ payload: { ...payload, note: 'None of the competitor sites could be read.' }, status: 'empty' });
        if (!upd.ok || !upd.data?.length) return res.status(409).json({ error: 'This report changed while saving — try again.', code: 'conflict' });
        return res.json({ ok: true, artifactId: artifact.id, status: 'empty', profiles, note: 'None of the competitor sites could be read, so there is nothing to report.' });
      }
      if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: 'ANTHROPIC_API_KEY is not configured.' });
      const seo = cleanSeoMetrics(body.seoMetrics, profiles);
      let built;
      try {
        built = await buildCompetitorReport(profiles, seo, { businessContext: payload.businessContext, language: payload.params?.language });
      } catch (e) {
        return res.status(502).json({ error: `Scout could not write the report: ${e.message}` });
      }
      const upd = await save({ title: built.title, payload: { ...payload, seo, report: { markdown: built.markdown, findings: built.findings, review: built.review } }, status: 'pending_approval' });
      if (!upd.ok) return res.status(500).json({ error: 'Could not save the report.' });
      if (!Array.isArray(upd.data) || !upd.data.length) return res.status(409).json({ error: 'This report changed while saving — try again.', code: 'conflict' });
      return res.json({ ok: true, artifactId: artifact.id, status: 'pending_approval', title: built.title, markdown: built.markdown, review: built.review, readable: readable.length, unreadable: profiles.length - readable.length });
    }

    return res.status(400).json({ error: `Unknown action "${body.action}". Use 'start', 'analyze' or 'finish'.` });
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
});

module.exports.cleanSeoMetrics = cleanSeoMetrics;
module.exports.cleanUrl = cleanUrl;
