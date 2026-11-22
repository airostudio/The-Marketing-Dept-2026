/**
 * api/cron-autopilot.js — every few minutes: start the autopilot work that
 * is due and move every running piece of work forward a step, repairing
 * what it can (api/_lib/autopilot/runner.js).
 *
 * Auth: Authorization: Bearer <CRON_SECRET> (Vercel cron).
 */

'use strict';

const { sbRest } = require('./_lib/supabase-rest.js');
const { withFailureReporting, reportFailureAsync } = require('./_lib/report-failure.js');
const runner = require('./_lib/autopilot/runner.js');
const registry = require('./_lib/autopilot/registry.js');

module.exports = withFailureReporting('api/cron-autopilot', async function handler(req, res) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return res.status(500).json({ error: 'CRON_SECRET is not configured — refusing to run unauthenticated.' });
  if (req.headers['authorization'] !== `Bearer ${cronSecret}`) return res.status(401).json({ error: 'Unauthorized' });
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: 'SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not configured.' });
  const sb = (m, p, b) => sbRest(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, m, p, b);
  const out = await runner.tick(sb, { registry, reportFailure: (f) => reportFailureAsync && reportFailureAsync(f) });
  return res.json({ ok: true, ...out });
});
