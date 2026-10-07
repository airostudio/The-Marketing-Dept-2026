/**
 * api/mission-chase.js — run Chase for real, as a step of a Scotty mission.
 *
 * POST { action: 'start', sourceArtifactId? | urls?: string[], industry?, intelProfileId?, missionId? }
 *   Builds the list to audit — either the websites on a finished Blade
 *   shortlist from this mission (sourceArtifactId), or URLs a person typed —
 *   and saves it as a new mission_artifacts row (kind 'chase_audit', status
 *   'building'). Nothing is audited yet.
 * POST { action: 'audit', artifactId, batchSize? }
 *   Audits the next few sites (a bounded crawl, technology detection and a
 *   PageSpeed run each — slow, hence the batches) and saves each one's score,
 *   platform and top problems. Call repeatedly until remaining is 0, at which
 *   point the artifact flips to 'pending_approval'.
 * Header: Authorization: Bearer <the caller's own Supabase access token>
 *
 * Nothing is sent and no contact is changed here. Approving the finished
 * audit (api/mission-artifacts.js) tags the prospects already in the audience
 * by how strong an opportunity they are.
 *
 * Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY. Optional: GOOGLE_PAGESPEED_API_KEY.
 */

'use strict';

const { sbRest, isUuid } = require('./_lib/supabase-rest.js');
const { withFailureReporting } = require('./_lib/report-failure.js');
const { rateLimited } = require('./_lib/rate-limit.js');
const { canAccessRecord } = require('./_lib/profile-access.js');
const { auditLead } = require('./_lib/chase-pipeline.js');
const { runWithConcurrency, cleanParam } = require('./_lib/blade-pipeline.js');

const MAX_SITES = 25;       // a mission's hard cap — each audit is a crawl plus a PageSpeed run
const MAX_BATCH = 3;
const AUDIT_CONCURRENCY = 3;

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

/** An http(s) URL, normalised; '' if it is not one. */
function cleanUrl(v) {
  const s = String(v || '').trim().slice(0, 300);
  if (!s) return '';
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    return /^https?:$/.test(u.protocol) && u.hostname.includes('.') ? u.toString() : '';
  } catch { return ''; }
}

const toLead = (l) => ({
  key: l.placeId || l.website, name: l.name || '', website: l.website, phone: l.phone || '',
  email: l.email || null, area: l.area || '', rating: l.rating, reviewCount: l.reviewCount,
  audited: false,
});

module.exports = withFailureReporting('api/mission-chase', async function handler(req, res) {
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

  // Every audit crawls a third-party site and spends the account's PageSpeed quota.
  if (rateLimited(req, res, { name: 'mission-chase', max: 30, windowMs: 60 * 1000, auth: { userId: caller.id } })) return;

  const sb = (m, p, b) => sbRest(supabaseUrl, serviceKey, m, p, b);
  const body = req.body || {};

  try {
    /* ── start ────────────────────────────────────────────────────────── */
    if (body.action === 'start') {
      let intelProfileId = null;
      if (body.intelProfileId) {
        if (!isUuid(body.intelProfileId)) return res.status(400).json({ error: 'intelProfileId is not a valid id.' });
        const allowed = await canAccessRecord(supabaseUrl, serviceKey, caller.id,
          { user_id: null, intel_profile_id: body.intelProfileId }, { requireEdit: true });
        if (!allowed) return res.status(403).json({ error: 'You do not have edit access to that business profile.' });
        intelProfileId = body.intelProfileId;
      }

      let candidates = [];
      let source = { type: 'urls' };
      let title = 'Website audit';
      let industry = cleanParam(body.industry);

      if (body.sourceArtifactId) {
        if (!isUuid(body.sourceArtifactId)) return res.status(400).json({ error: 'sourceArtifactId is not a valid id.' });
        const r = await sb('GET', `/mission_artifacts?id=eq.${body.sourceArtifactId}&limit=1`);
        if (!r.ok) return res.status(r.status === 404 ? 503 : 500).json(tableError(r));
        const src = r.data && r.data[0];
        const allowed = src && src.kind === 'blade_leads' && await canAccessRecord(supabaseUrl, serviceKey, caller.id, src, { requireEdit: false });
        if (!allowed) return res.status(404).json({ error: 'Blade list not found.' });
        if (src.status === 'building') return res.status(409).json({ error: 'That Blade list is still being built.' });
        if (src.status === 'rejected') return res.status(409).json({ error: 'That Blade list was rejected.' });
        const leads = Array.isArray(src.payload?.leads) ? src.payload.leads : [];
        candidates = leads.filter(l => l.website).map(toLead);
        source = { type: 'blade', artifactId: src.id, totalLeads: leads.length, noWebsite: leads.filter(l => !l.website).length };
        title = `Website audit — ${src.title}`;
        industry = industry || cleanParam(src.payload?.params?.sector);
      } else {
        const urls = Array.isArray(body.urls) ? body.urls : [];
        const seen = new Set();
        for (const u of urls) {
          const url = cleanUrl(u);
          if (!url) continue;
          const host = new URL(url).hostname.replace(/^www\./, '');
          if (seen.has(host)) continue;
          seen.add(host);
          candidates.push({ key: url, name: host, website: url, phone: '', email: null, area: '', audited: false });
        }
        if (!candidates.length) return res.status(400).json({ error: 'Give Chase a Blade list from this mission or at least one website address to audit.', field: 'urls' });
      }

      const truncated = candidates.length > MAX_SITES;
      const leads = candidates.slice(0, MAX_SITES);
      const empty = leads.length === 0;
      const created = await sb('POST', '/mission_artifacts', {
        user_id: caller.id,
        intel_profile_id: intelProfileId,
        mission_id: body.missionId ? String(body.missionId).slice(0, 80) : null,
        agent_key: 'chase',
        kind: 'chase_audit',
        title,
        payload: { params: { industry }, source, truncated, leads },
        status: empty ? 'empty' : 'building',
      });
      if (!created.ok) return res.status(created.status === 404 ? 503 : 500).json(tableError(created));
      const artifact = created.data && created.data[0];
      return res.json({
        ok: true, artifactId: artifact.id, status: artifact.status, source, truncated, leads, remaining: leads.length,
        note: empty ? 'None of the businesses on that list have a website, so there is nothing for Chase to audit.' : undefined,
      });
    }

    /* ── audit ────────────────────────────────────────────────────────── */
    if (body.action === 'audit') {
      if (!body.artifactId || !isUuid(body.artifactId)) return res.status(400).json({ error: 'artifactId is required.' });
      const r = await sb('GET', `/mission_artifacts?id=eq.${body.artifactId}&limit=1`);
      if (!r.ok) return res.status(r.status === 404 ? 503 : 500).json(tableError(r));
      const artifact = r.data && r.data[0];
      const allowed = artifact && artifact.kind === 'chase_audit'
        && await canAccessRecord(supabaseUrl, serviceKey, caller.id, artifact, { requireEdit: true });
      if (!allowed) return res.status(404).json({ error: 'Artifact not found.' });
      if (artifact.status !== 'building') {
        return res.status(409).json({ error: `This audit is already ${artifact.status.replace('_', ' ')} — it is no longer being built.` });
      }

      const payload = artifact.payload || {};
      const leads = Array.isArray(payload.leads) ? payload.leads : [];
      const batchSize = Math.max(1, Math.min(MAX_BATCH, parseInt(body.batchSize, 10) || MAX_BATCH));
      const pendingIdx = leads.map((l, i) => (l.audited ? -1 : i)).filter(i => i >= 0).slice(0, batchSize);

      await runWithConcurrency(pendingIdx, AUDIT_CONCURRENCY, async (i) => {
        leads[i] = await auditLead(leads[i], { industry: payload.params?.industry || '', pagespeedApiKey: process.env.GOOGLE_PAGESPEED_API_KEY });
      });

      const remaining = leads.filter(l => !l.audited).length;
      const nextStatus = remaining === 0 ? 'pending_approval' : 'building';
      const upd = await sb('PATCH', `/mission_artifacts?id=eq.${artifact.id}`, {
        payload: { ...payload, leads }, status: nextStatus, updated_at: new Date().toISOString(),
      });
      if (!upd.ok) return res.status(500).json({ error: 'Could not save the audit results.' });

      const done = leads.filter(l => l.audited);
      return res.json({
        ok: true, artifactId: artifact.id, status: nextStatus, processed: pendingIdx.length, remaining,
        scored: done.filter(l => l.audit).length, failed: done.filter(l => l.auditError).length,
        leads: pendingIdx.map(i => leads[i]),
      });
    }

    return res.status(400).json({ error: `Unknown action "${body.action}". Use 'start' or 'audit'.` });
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
});
