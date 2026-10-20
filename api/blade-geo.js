/**
 * api/blade-geo.js — the drill-down Blade's area picker uses: countries →
 * states/regions → counties/districts → cities and towns (GeoNames, see
 * api/_lib/geonames.js).
 *
 * POST { action: 'countries' }
 * POST { action: 'children', geonameId, level: 'state'|'county' }
 * POST { action: 'towns', countryCode, adminCode1, adminCode2?, minPopulation? }
 *   → { towns (up to 300 shown), count, truncated }
 * Header: Authorization: Bearer <Supabase access token>
 *
 * Env: GEONAMES_USERNAME.
 */

'use strict';

const { requireUser } = require('./_lib/require-user.js');
const { withFailureReporting } = require('./_lib/report-failure.js');
const { rateLimited } = require('./_lib/rate-limit.js');
const geonames = require('./_lib/geonames.js');

const code = (v) => String(v == null ? '' : v).trim().slice(0, 20).replace(/[^A-Za-z0-9.-]/g, '');

module.exports = withFailureReporting('api/blade-geo', async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const auth = await requireUser(req, res);
  if (!auth) return;
  // GeoNames' free tier allows about 1,000 calls an hour for the whole service.
  if (rateLimited(req, res, { name: 'blade-geo', max: 40, windowMs: 60 * 1000, auth })) return;
  if (!process.env.GEONAMES_USERNAME) return res.status(503).json({ error: geonames.NOT_CONFIGURED, code: 'not_configured' });

  const body = req.body || {};
  try {
    if (body.action === 'countries') return res.json({ ok: true, countries: await geonames.countries() });
    if (body.action === 'children') {
      const id = Number(body.geonameId);
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'geonameId is required.' });
      const level = body.level === 'county' ? 'county' : 'state';
      return res.json({ ok: true, level, areas: await geonames.children(id, level) });
    }
    if (body.action === 'towns') {
      const countryCode = code(body.countryCode).toUpperCase(), adminCode1 = code(body.adminCode1), adminCode2 = code(body.adminCode2);
      if (!countryCode || !adminCode1) return res.status(400).json({ error: 'Pick a country and a state or region first.' });
      const minPopulation = Math.max(0, Math.min(1000000, parseInt(body.minPopulation, 10) || 0));
      const r = await geonames.towns({ countryCode, adminCode1, adminCode2: adminCode2 || undefined, minPopulation });
      return res.json({ ok: true, count: r.towns.length, truncated: r.truncated, towns: r.towns.slice(0, 300) });
    }
    return res.status(400).json({ error: `Unknown action "${body.action}".` });
  } catch (e) {
    return res.status(e.status && e.status < 600 ? e.status : 502).json({ error: e.message });
  }
});
