/**
 * api/site-snapshot.js — capture a screenshot of a watchlisted client site
 * and save it to its history, for a before/after comparison.
 *
 * POST { action: 'capture', watchlistId, label? }   // label defaults to 'before' on the first shot, 'after' otherwise
 * POST { action: 'list',    watchlistId }
 * POST { action: 'remove',  snapshotId }
 * Header: Authorization: Bearer <the caller's own Supabase access token>
 *
 * Reuses the exact same bounded, non-full-page screenshot capture Nancy
 * already uses (api/_lib/nancy-providers.js#screenshotProvider — see that
 * file for why it's capped well under Claude's 8000px image limit) and
 * the same R2 upload (api/_lib/r2.js) nancy-screenshot.js already does.
 * Nothing new here is a security boundary: a client's website is a public
 * URL like any other this app already screenshots, and api/_lib/
 * safe-fetch.js's SSRF protection (blocking only private/internal
 * addresses) applies exactly the same way it does everywhere else.
 */

'use strict';

const { sbRest } = require('./_lib/supabase-rest.js');
const { withFailureReporting } = require('./_lib/report-failure.js');
const { rateLimited } = require('./_lib/rate-limit.js');
const { canAccessRecord } = require('./_lib/profile-access.js');
const { screenshotProvider } = require('./_lib/nancy-providers.js');
const { uploadToR2, isR2Configured } = require('./_lib/r2.js');

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 6; // matches nancy-screenshot.js — same paid screenshot provider, same budget

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

module.exports = withFailureReporting('api/site-snapshot', async function handler(req, res) {
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

  async function ownedSite(watchlistId, { requireEdit = true } = {}) {
    if (!watchlistId) return { http: 400, err: { error: 'watchlistId is required.' } };
    const r = await sb('GET', `/site_watchlist?id=eq.${encodeURIComponent(watchlistId)}&limit=1`);
    if (!r.ok) return { http: r.status === 404 ? 503 : 500, err: tableError(r) };
    const site = r.data && r.data[0];
    const allowed = site && await canAccessRecord(supabaseUrl, serviceKey, caller.id, site, { requireEdit });
    if (!allowed) return { http: 404, err: { error: 'That site is not on your watchlist.' } };
    return { site };
  }

  try {
    if (body.action === 'capture') {
      // Every path below reaches a paid third-party screenshot provider on
      // the account's own credentials. Identify the caller first (already
      // done above); a rate limit caps the speed, not the entitlement.
      if (rateLimited(req, res, { name: 'site-snapshot-capture', max: RATE_LIMIT_MAX, windowMs: RATE_LIMIT_WINDOW_MS, auth: { userId: caller.id } })) return;

      const { site, http, err } = await ownedSite(body.watchlistId);
      if (err) return res.status(http).json(err);

      if (!isR2Configured()) {
        return res.status(503).json({
          error: 'Image hosting (R2) is not configured, so a captured screenshot would have nowhere permanent to live. Set R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_BUCKET_NAME.',
        });
      }

      const shot = await screenshotProvider(site.url);
      if (!shot.available) {
        return res.status(502).json({ error: shot.reason || 'Could not capture a screenshot of that site right now.' });
      }

      // Default label: 'before' for the very first shot of this site,
      // 'after' for every one after that — the common case needs no typing,
      // and anyone can still pass their own label for a longer history.
      let label = body.label ? String(body.label).trim().slice(0, 40) : null;
      if (!label) {
        const existing = await sb('GET', `/site_snapshots?watchlist_id=eq.${site.id}&select=id&limit=1`);
        label = (existing.ok && existing.data && existing.data.length) ? 'after' : 'before';
      }

      const ext = shot.mimeType === 'image/jpeg' ? 'jpg' : 'png';
      const key = `site-snapshots/${site.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const hostedUrl = await uploadToR2(key, shot.buffer, shot.mimeType);
      if (!hostedUrl) {
        return res.status(503).json({ error: 'The screenshot was captured but could not be given a public URL (R2_PUBLIC_BASE_URL is not set).' });
      }

      const ins = await sb('POST', '/site_snapshots', {
        watchlist_id: site.id, label, hosted_url: hostedUrl, mime_type: shot.mimeType,
      });
      if (!ins.ok) return res.status(ins.status === 404 ? 503 : 500).json(tableError(ins));
      const snap = ins.data && ins.data[0];
      return res.json({ ok: true, snapshot: { id: snap.id, label: snap.label, hostedUrl: snap.hosted_url, capturedAt: snap.captured_at } });
    }

    if (body.action === 'list') {
      const { http, err } = await ownedSite(body.watchlistId, { requireEdit: false });
      if (err) return res.status(http).json(err);
      const r = await sb('GET', `/site_snapshots?watchlist_id=eq.${encodeURIComponent(body.watchlistId)}&order=captured_at.desc&limit=100`);
      if (!r.ok) return res.status(r.status === 404 ? 503 : 500).json(tableError(r));
      return res.json({ ok: true, snapshots: (r.data || []).map(s => ({
        id: s.id, label: s.label, hostedUrl: s.hosted_url, capturedAt: s.captured_at,
      })) });
    }

    if (body.action === 'remove') {
      if (!body.snapshotId) return res.status(400).json({ error: 'snapshotId is required.' });
      const snapRes = await sb('GET', `/site_snapshots?id=eq.${encodeURIComponent(body.snapshotId)}&limit=1`);
      if (!snapRes.ok) return res.status(snapRes.status === 404 ? 503 : 500).json(tableError(snapRes));
      const snap = snapRes.data && snapRes.data[0];
      if (!snap) return res.status(404).json({ error: 'Snapshot not found.' });
      const { err } = await ownedSite(snap.watchlist_id);
      if (err) return res.status(404).json({ error: 'Snapshot not found.' });

      const del = await sb('DELETE', `/site_snapshots?id=eq.${encodeURIComponent(body.snapshotId)}`);
      if (!del.ok) return res.status(500).json({ error: 'Could not remove that snapshot.' });
      return res.json({ ok: true });
    }

    return res.status(400).json({ error: `Unknown action "${body.action}". Use 'capture', 'list' or 'remove'.` });
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
});
