/**
 * api/cron-blade-sweeps.js — keeps Blade's area sweeps moving with nobody's
 * browser open: every few minutes it runs one batch for each running sweep
 * (oldest-touched first) until its own time runs out. See
 * api/_lib/blade-sweep.js for what a batch does.
 *
 * Auth: Authorization: Bearer <CRON_SECRET> (Vercel cron).
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GOOGLE_PLACES_API_KEY,
 * GEONAMES_USERNAME (country-wide sweeps), GOOGLE_SERVICE_ACCOUNT_JSON (tracker writes).
 */

'use strict';

const { sbRest } = require('./_lib/supabase-rest.js');
const { withFailureReporting } = require('./_lib/report-failure.js');
const { tick } = require('./_lib/blade-sweep.js');
const notify = require('./_lib/autopilot/notify.js');

const TOTAL_BUDGET_MS = 120000;
const MIN_BATCH_MS = 50000;

module.exports = withFailureReporting('api/cron-blade-sweeps', async function handler(req, res) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return res.status(500).json({ error: 'CRON_SECRET is not configured — refusing to run unauthenticated.' });
  if (req.headers['authorization'] !== `Bearer ${cronSecret}`) return res.status(401).json({ error: 'Unauthorized' });
  const supabaseUrl = process.env.SUPABASE_URL, serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return res.status(500).json({ error: 'SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not configured.' });
  const placesKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!placesKey) return res.status(500).json({ error: 'GOOGLE_PLACES_API_KEY not configured.' });
  const sb = (m, p, b) => sbRest(supabaseUrl, serviceKey, m, p, b);

  const r = await sb('GET', '/blade_sweeps?status=eq.running&select=*&order=last_tick_at.asc.nullsfirst&limit=20');
  if (!r.ok) return res.status(r.status === 404 ? 200 : 500).json({ ok: r.status === 404, note: r.status === 404 ? 'Blade sweeps are not installed.' : `Database error (HTTP ${r.status}).` });

  const started = Date.now(); const ran = [];
  for (const sweep of r.data || []) {
    const left = TOTAL_BUDGET_MS - (Date.now() - started);
    if (left < MIN_BATCH_MS) break;
    try {
      const out = await tick(sb, sweep, { placesKey, budgetMs: Math.min(left, 90000) });
      ran.push({ id: sweep.id, ...out });
      await notify.sweepResult(sb, sweep, out);
    } catch (e) {
      ran.push({ id: sweep.id, ran: false, error: e.message });
    }
  }
  return res.json({ ok: true, sweeps: (r.data || []).length, ran });
});
