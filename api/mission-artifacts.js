/**
 * api/mission-artifacts.js — see and decide on what a Scotty mission
 * actually produced.
 *
 * POST { action: 'list',    status?, missionId? }
 * POST { action: 'get',     artifactId }
 * POST { action: 'approve', artifactId }
 * POST { action: 'reject',  artifactId }
 * Header: Authorization: Bearer <the caller's own Supabase access token>
 *
 * Approving is the one human checkpoint in an otherwise automatic mission,
 * so it is deliberately the only place a real effect happens, and a
 * deliberately narrow one:
 *
 *   blade_leads — imports the shortlisted businesses that have a real email
 *   into Beeker's contacts, tagged 'blade-prospect' plus the trade, with how
 *   they were found recorded as the contact's consent_source (an honest
 *   "found via public listing, no prior opt-in", never a made-up opt-in).
 *   It sends nothing. Sending is Pat's job, behind Pat's own checks and the
 *   unsubscribe/suppression machinery every send already goes through.
 *
 * An artifact can be decided exactly once: the status change is a conditional
 * update, so a double-click or two teammates approving at the same moment
 * cannot import the same list twice.
 */

'use strict';

const { sbRest, isUuid } = require('./_lib/supabase-rest.js');
const { withFailureReporting } = require('./_lib/report-failure.js');
const { rateLimited } = require('./_lib/rate-limit.js');
const { canAccessRecord, accessibleProfileIds, ownedOrSharedFilter } = require('./_lib/profile-access.js');
const { runWithConcurrency } = require('./_lib/blade-pipeline.js');

const STATUSES = ['building', 'pending_approval', 'approved', 'rejected', 'empty'];
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const CONSENT_SOURCE = 'Found by Blade on the business\'s public Google listing / website. No prior opt-in from this contact.';

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

function slug(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
}

function summarise(a) {
  const leads = Array.isArray(a.payload?.leads) ? a.payload.leads : [];
  return {
    id: a.id, kind: a.kind, agentKey: a.agent_key, title: a.title, status: a.status,
    missionId: a.mission_id, createdAt: a.created_at, decidedAt: a.decided_at,
    attention: a.payload?.attention || null,
    counts: { leads: leads.length, withEmail: leads.filter(l => l.email).length, withOwner: leads.filter(l => l.ownerFirstName).length },
  };
}

/** blade_leads → Beeker contacts. Returns the counts, never throws on a single bad row. */
async function importBladeLeads(sb, artifact, callerId) {
  const payload = artifact.payload || {};
  const leads = Array.isArray(payload.leads) ? payload.leads : [];

  const withEmail = leads.filter(l => l.email && EMAIL_RE.test(String(l.email).trim()));
  const skippedNoEmail = leads.length - withEmail.length;
  if (!withEmail.length) return { imported: 0, skippedNoEmail, skippedExisting: 0, failed: 0 };

  const emails = [...new Set(withEmail.map(l => String(l.email).trim().toLowerCase()))];
  const existingRes = await sb('GET',
    `/contacts?user_id=eq.${callerId}&email=in.(${emails.map(encodeURIComponent).join(',')})&select=email`);
  // If we cannot tell who is already in the audience, importing blind could
  // resurrect someone who unsubscribed — stop rather than guess.
  if (!existingRes.ok) throw new Error('Could not check which of these people are already in your audience.');
  const existing = new Set((existingRes.data || []).map(c => String(c.email).toLowerCase()));

  const sectorTag = slug(payload.params?.sector);
  const tags = ['blade-prospect', ...(sectorTag ? [sectorTag] : [])];
  const now = new Date().toISOString();

  const seen = new Set();
  const toInsert = [];
  let skippedExisting = 0;
  for (const l of withEmail) {
    const email = String(l.email).trim().toLowerCase();
    if (existing.has(email) || seen.has(email)) { skippedExisting++; continue; }
    seen.add(email);
    toInsert.push({
      user_id: callerId,
      intel_profile_id: artifact.intel_profile_id || null,
      email,
      first_name: l.ownerFirstName || null,
      company: l.name || null,
      custom_fields: {
        website: l.website || null, phone: l.phone || null, area: l.area || null,
        website_status: l.siteStatus || null, personal_note: l.note || null,
        place_id: l.placeId || null,
        email_source: l.emailSource || null, email_source_url: l.emailSourceUrl || null,
      },
      tags,
      status: 'subscribed',
      source: 'blade_mission',
      consent_source: CONSENT_SOURCE,
      consent_timestamp: now,
    });
  }

  let imported = 0, failed = 0;
  const failedLeads = [];
  await runWithConcurrency(toInsert, 5, async (row) => {
    const ins = await sb('POST', '/contacts', row);
    if (ins.ok) imported++;
    else if (ins.status === 409) skippedExisting++;   // raced with another import
    else {
      failed++;
      // Named, so a person (and the cleanup agent that reports it) knows
      // exactly who didn't make it in, not just how many.
      failedLeads.push({ email: row.email, name: row.company, status: ins.status });
    }
  });
  return { imported, skippedNoEmail, skippedExisting, failed, failedLeads: failedLeads.slice(0, 50) };
}

module.exports = withFailureReporting('api/mission-artifacts', async function handler(req, res) {
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

  if (rateLimited(req, res, { name: 'mission-artifacts', max: 60, windowMs: 60 * 1000, auth: { userId: caller.id } })) return;

  const sb = (m, p, b) => sbRest(supabaseUrl, serviceKey, m, p, b);
  const body = req.body || {};

  async function load(artifactId, { requireEdit }) {
    if (!artifactId || !isUuid(artifactId)) return { http: 400, err: { error: 'artifactId is required.' } };
    const r = await sb('GET', `/mission_artifacts?id=eq.${artifactId}&limit=1`);
    if (!r.ok) return { http: r.status === 404 ? 503 : 500, err: tableError(r) };
    const a = r.data && r.data[0];
    const allowed = a && await canAccessRecord(supabaseUrl, serviceKey, caller.id, a, { requireEdit });
    if (!allowed) return { http: 404, err: { error: 'Artifact not found.' } };
    return { artifact: a };
  }

  try {
    if (body.action === 'list') {
      const profileIds = await accessibleProfileIds(supabaseUrl, serviceKey, caller.id);
      const filters = [ownedOrSharedFilter(caller.id, profileIds)];
      if (body.status) {
        if (!STATUSES.includes(body.status)) return res.status(400).json({ error: `status must be one of: ${STATUSES.join(', ')}` });
        filters.push(`status=eq.${body.status}`);
      }
      if (body.missionId) {
        if (!/^[A-Za-z0-9_-]{1,80}$/.test(String(body.missionId))) return res.status(400).json({ error: 'missionId is not valid.' });
        filters.push(`mission_id=eq.${body.missionId}`);
      }
      const r = await sb('GET', `/mission_artifacts?${filters.join('&')}&order=created_at.desc&limit=100`);
      if (!r.ok) return res.status(r.status === 404 ? 503 : 500).json(tableError(r));
      return res.json({ ok: true, artifacts: (r.data || []).map(summarise) });
    }

    if (body.action === 'get') {
      const { artifact, http, err } = await load(body.artifactId, { requireEdit: false });
      if (err) return res.status(http).json(err);
      return res.json({ ok: true, artifact: { ...summarise(artifact), payload: artifact.payload } });
    }

    if (body.action === 'approve' || body.action === 'reject') {
      const { artifact, http, err } = await load(body.artifactId, { requireEdit: true });
      if (err) return res.status(http).json(err);
      if (artifact.status !== 'pending_approval') {
        return res.status(409).json({ error: `This is ${artifact.status.replace('_', ' ')}, so it cannot be ${body.action === 'approve' ? 'approved' : 'rejected'} now.` });
      }

      const target = body.action === 'approve' ? 'approved' : 'rejected';
      // Claim the decision atomically: only a row still pending_approval flips,
      // so of two simultaneous clicks exactly one gets a row back.
      const claim = await sb('PATCH', `/mission_artifacts?id=eq.${artifact.id}&status=eq.pending_approval`, {
        status: target, decided_by: caller.id, decided_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      });
      if (!claim.ok) return res.status(500).json({ error: 'Could not record the decision.' });
      if (!Array.isArray(claim.data) || !claim.data.length) {
        return res.status(409).json({ error: 'Someone else already decided this.' });
      }
      if (target === 'rejected') return res.json({ ok: true, status: 'rejected' });

      let result;
      try {
        if (artifact.kind === 'blade_leads') result = await importBladeLeads(sb, artifact, caller.id);
        else result = {};
      } catch (e) {
        // Nothing was imported and nobody was told it had been — hand the
        // artifact back so the approval can simply be tried again.
        await sb('PATCH', `/mission_artifacts?id=eq.${artifact.id}`, { status: 'pending_approval', decided_by: null, decided_at: null });
        return res.status(502).json({ error: e.message });
      }

      await sb('PATCH', `/mission_artifacts?id=eq.${artifact.id}`, {
        payload: { ...(artifact.payload || {}), approval: { ...result, at: new Date().toISOString(), by: caller.id } },
        updated_at: new Date().toISOString(),
      });
      return res.json({ ok: true, status: 'approved', result });
    }

    return res.status(400).json({ error: `Unknown action "${body.action}". Use 'list', 'get', 'approve' or 'reject'.` });
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
});
