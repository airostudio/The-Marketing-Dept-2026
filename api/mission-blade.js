/**
 * api/mission-blade.js — run Blade for real, as a step of a Scotty mission.
 *
 * POST { action: 'discover', sector, city, country?, maxLeads?, intelProfileId?, missionId? }
 *   One Places search + a quick site check per result + shortlist, saved as a
 *   new mission_artifacts row (status 'building'). Returns the artifact id
 *   and the shortlisted leads.
 * POST { action: 'enrich', artifactId, batchSize? }
 *   Finds an email and owner name for the next few leads that don't have
 *   them yet, saves them, and says how many remain. Call repeatedly until
 *   remaining is 0 — at which point the artifact flips to 'pending_approval'.
 *   Batched because each lead's lookups are slow (an email crawl plus an
 *   owner search); a whole shortlist in one request would not fit in the
 *   function-duration ceiling.
 * Header: Authorization: Bearer <the caller's own Supabase access token>
 *
 * Nothing here sends anything or touches the audience. The finished artifact
 * waits for a person's approval in api/mission-artifacts.js.
 *
 * Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GOOGLE_PLACES_API_KEY.
 * Optional (owner names / email fallback search): APOLLO_API_KEY, PERPLEXITY_API_KEY.
 */

'use strict';

const { sbRest, isUuid } = require('./_lib/supabase-rest.js');
const { withFailureReporting } = require('./_lib/report-failure.js');
const { rateLimited } = require('./_lib/rate-limit.js');
const { canAccessRecord } = require('./_lib/profile-access.js');
const { discoverLeads, enrichLead, runWithConcurrency, cleanParam, DEFAULT_MAX_LEADS } = require('./_lib/blade-pipeline.js');

const MAX_LEADS_CEILING = 40;     // a mission's hard cap, whatever a caller asks for
const MAX_BATCH = 5;
const ENRICH_CONCURRENCY = 5;

async function getCallerFromToken(supabaseUrl, serviceKey, accessToken) {
  const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return null;
  return res.json();
}

function tableError(res) {
  if (res.status === 404) {
    return { code: 'not_installed', error: 'Mission artifacts are not installed. Run supabase-mission-artifacts.sql in the Supabase SQL editor.' };
  }
  return { code: 'db_error', error: `Database error (HTTP ${res.status}).` };
}

module.exports = withFailureReporting('api/mission-blade', async function handler(req, res) {
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

  // Every path below spends paid third-party credits (Places, Perplexity,
  // Apollo) and this server's crawler on the account. The caller is known by
  // now; a rate limit caps the speed, not the entitlement.
  if (rateLimited(req, res, { name: 'mission-blade', max: 30, windowMs: 60 * 1000, auth: { userId: caller.id } })) return;

  const sb = (m, p, b) => sbRest(supabaseUrl, serviceKey, m, p, b);
  const body = req.body || {};

  try {
    /* ── discover ─────────────────────────────────────────────────────── */
    if (body.action === 'discover') {
      const placesKey = process.env.GOOGLE_PLACES_API_KEY;
      if (!placesKey) return res.status(503).json({ error: 'GOOGLE_PLACES_API_KEY is not configured, so Blade cannot search for businesses.' });

      const sector = cleanParam(body.sector);
      const city = cleanParam(body.city);
      const country = cleanParam(body.country);
      if (!sector) return res.status(400).json({ error: 'A trade or sector (e.g. "plumbers") is required.', field: 'sector' });
      if (!city) return res.status(400).json({ error: 'A city or area is required.', field: 'city' });

      let intelProfileId = null;
      if (body.intelProfileId) {
        if (!isUuid(body.intelProfileId)) return res.status(400).json({ error: 'intelProfileId is not a valid id.' });
        const allowed = await canAccessRecord(supabaseUrl, serviceKey, caller.id,
          { user_id: null, intel_profile_id: body.intelProfileId }, { requireEdit: true });
        if (!allowed) return res.status(403).json({ error: 'You do not have edit access to that business profile.' });
        intelProfileId = body.intelProfileId;
      }

      const maxLeads = Math.max(1, Math.min(MAX_LEADS_CEILING, parseInt(body.maxLeads, 10) || DEFAULT_MAX_LEADS));

      let found;
      try {
        found = await discoverLeads({ placesKey, sector, city, country, maxLeads });
      } catch (e) {
        return res.status(502).json({ error: `Blade could not search for businesses: ${e.message}` });
      }

      const empty = found.leads.length === 0;
      const created = await sb('POST', '/mission_artifacts', {
        user_id: caller.id,
        intel_profile_id: intelProfileId,
        mission_id: body.missionId ? String(body.missionId).slice(0, 80) : null,
        agent_key: 'blade',
        kind: 'blade_leads',
        title: `${sector} in ${city}${country ? ', ' + country : ''}`,
        payload: { params: { sector, city, country, maxLeads }, stats: found.stats, leads: found.leads },
        status: empty ? 'empty' : 'building',
      });
      if (!created.ok) return res.status(created.status === 404 ? 503 : 500).json(tableError(created));
      const artifact = created.data && created.data[0];

      return res.json({
        ok: true, artifactId: artifact.id, status: artifact.status,
        stats: found.stats, leads: found.leads,
        remaining: found.leads.length,
        note: empty
          ? `Blade checked ${found.stats.candidatesChecked} businesses and none showed a genuine website opportunity (every one had a modern site), so there is nothing to approve.`
          : undefined,
      });
    }

    /* ── enrich ───────────────────────────────────────────────────────── */
    if (body.action === 'enrich') {
      if (!body.artifactId || !isUuid(body.artifactId)) return res.status(400).json({ error: 'artifactId is required.' });

      const r = await sb('GET', `/mission_artifacts?id=eq.${body.artifactId}&limit=1`);
      if (!r.ok) return res.status(r.status === 404 ? 503 : 500).json(tableError(r));
      const artifact = r.data && r.data[0];
      const allowed = artifact && artifact.kind === 'blade_leads'
        && await canAccessRecord(supabaseUrl, serviceKey, caller.id, artifact, { requireEdit: true });
      if (!allowed) return res.status(404).json({ error: 'Artifact not found.' });
      if (artifact.status !== 'building') {
        return res.status(409).json({ error: `This list is already ${artifact.status.replace('_', ' ')} — it is no longer being built.` });
      }

      const payload = artifact.payload || {};
      const leads = Array.isArray(payload.leads) ? payload.leads : [];
      const batchSize = Math.max(1, Math.min(MAX_BATCH, parseInt(body.batchSize, 10) || MAX_BATCH));
      const pendingIdx = leads.map((l, i) => (l.enriched ? -1 : i)).filter(i => i >= 0).slice(0, batchSize);

      const country = payload.params?.country || '';
      await runWithConcurrency(pendingIdx, ENRICH_CONCURRENCY, async (i) => {
        leads[i] = await enrichLead(leads[i], { country });
      });

      const remaining = leads.filter(l => !l.enriched).length;
      const nextStatus = remaining === 0 ? 'pending_approval' : 'building';
      const upd = await sb('PATCH', `/mission_artifacts?id=eq.${artifact.id}`, {
        payload: { ...payload, leads },
        status: nextStatus,
        updated_at: new Date().toISOString(),
      });
      if (!upd.ok) return res.status(500).json({ error: 'Could not save the enriched leads.' });

      const done = leads.filter(l => l.enriched);
      return res.json({
        ok: true, artifactId: artifact.id, status: nextStatus, processed: pendingIdx.length, remaining,
        withEmail: done.filter(l => l.email).length,
        withOwner: done.filter(l => l.ownerFirstName).length,
        leads: pendingIdx.map(i => leads[i]),
      });
    }

    return res.status(400).json({ error: `Unknown action "${body.action}". Use 'discover' or 'enrich'.` });
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
});
