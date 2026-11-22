/**
 * api/site-watchlist.js — manage the saved list of client websites kept
 * for before/after screenshot comparisons. Capturing a screenshot itself
 * is a separate, slower endpoint (api/site-snapshot.js); this is just the
 * list.
 *
 * POST { action: 'list' }
 * POST { action: 'add',    clientName, url, intelProfileId? }
 * POST { action: 'remove', watchlistId }
 * Header: Authorization: Bearer <the caller's own Supabase access token>
 *
 * Shared via an intelligence profile the same way contacts/campaigns are —
 * see supabase-site-snapshots.sql.
 */

'use strict';

const { sbRest, isUuid } = require('./_lib/supabase-rest.js');
const { withFailureReporting } = require('./_lib/report-failure.js');
const { canAccessRecord, accessibleProfileIds, ownedOrSharedFilter } = require('./_lib/profile-access.js');

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
    return { code: 'not_installed',
             error: 'Site snapshots are not installed. Run supabase-site-snapshots.sql in the Supabase SQL editor.' };
  }
  return { code: 'db_error', error: `Database error (HTTP ${res.status}).` };
}

function parseUrl(raw) {
  const withProto = /^https?:\/\//i.test(raw) ? raw : 'https://' + raw;
  const url = new URL(withProto);
  if (!url.hostname.includes('.')) throw new Error('That does not look like a real website address.');
  return url.href;
}

module.exports = withFailureReporting('api/site-watchlist', async function handler(req, res) {
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

  const sb = (m, p, b) => sbRest(supabaseUrl, serviceKey, m, p, b);
  const body = req.body || {};

  try {
    if (body.action === 'list') {
      const profileIds = await accessibleProfileIds(supabaseUrl, serviceKey, caller.id);
      const r = await sb('GET',
        `/site_watchlist?${ownedOrSharedFilter(caller.id, profileIds)}&order=created_at.desc&limit=500`);
      if (!r.ok) return res.status(r.status === 404 ? 503 : 500).json(tableError(r));
      return res.json({ ok: true, sites: (r.data || []).map(w => ({
        id: w.id, clientName: w.client_name, url: w.url, notes: w.notes, createdAt: w.created_at,
      })) });
    }

    if (body.action === 'add') {
      const clientName = String(body.clientName || '').trim();
      if (!clientName) return res.status(400).json({ error: 'clientName is required.' });
      if (!body.url) return res.status(400).json({ error: 'url is required.' });

      let url;
      try { url = parseUrl(String(body.url).trim()); } catch (e) { return res.status(400).json({ error: e.message }); }

      // Same shared-profile attribution as contacts/campaigns — see
      // api/email-flows.js's create action for the full reasoning.
      let intelProfileId = null;
      if (body.intelProfileId) {
        if (!isUuid(body.intelProfileId)) return res.status(400).json({ error: 'intelProfileId is not a valid id.' });
        const allowed = await canAccessRecord(supabaseUrl, serviceKey, caller.id,
          { user_id: null, intel_profile_id: body.intelProfileId }, { requireEdit: true });
        if (!allowed) return res.status(403).json({ error: 'You do not have edit access to that business profile.' });
        intelProfileId = body.intelProfileId;
      }

      const created = await sb('POST', '/site_watchlist', {
        user_id: caller.id, intel_profile_id: intelProfileId,
        client_name: clientName, url, notes: body.notes ? String(body.notes).slice(0, 2000) : null,
      });
      if (!created.ok) return res.status(created.status === 404 ? 503 : 500).json(tableError(created));
      const row = created.data && created.data[0];
      return res.json({ ok: true, site: { id: row.id, clientName: row.client_name, url: row.url } });
    }

    if (body.action === 'remove') {
      if (!body.watchlistId) return res.status(400).json({ error: 'watchlistId is required.' });
      const r = await sb('GET', `/site_watchlist?id=eq.${encodeURIComponent(body.watchlistId)}&limit=1`);
      if (!r.ok) return res.status(r.status === 404 ? 503 : 500).json(tableError(r));
      const site = r.data && r.data[0];
      const allowed = site && await canAccessRecord(supabaseUrl, serviceKey, caller.id, site, { requireEdit: true });
      if (!allowed) return res.status(404).json({ error: 'That site is not on your watchlist.' });

      const del = await sb('DELETE', `/site_watchlist?id=eq.${encodeURIComponent(body.watchlistId)}`);
      if (!del.ok) return res.status(500).json({ error: 'Could not remove that site.' });
      return res.json({ ok: true });
    }

    return res.status(400).json({ error: `Unknown action "${body.action}". Use 'list', 'add' or 'remove'.` });
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
});
