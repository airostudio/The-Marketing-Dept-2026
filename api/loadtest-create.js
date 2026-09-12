/**
 * api/loadtest-create.js — start a new Load Testing Agent run.
 *
 * POST { virtualUsers, durationDays, personaMix, generationConcurrency,
 *        spike, artificialAiDelay, apiFailureInjection, costPerGenerationUsd }
 * Returns: { success, run }
 *
 * Gated by BOTH normal Audema login (requireUser, inside
 * requireInternalToolsAccess) AND the internal-tools unlock token — the same
 * password/token system that already gates the BuiltWith research tool (see
 * api/_lib/internal-tools-access-token.js).
 *
 * Validates the config against the hard caps in api/_lib/loadtest-engine.js,
 * enforces "only one active (running/paused) run at a time" (rejecting a
 * second start rather than queueing or auto-cancelling), inserts the run as
 * 'draft', then immediately transitions it to 'running'.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * This endpoint never calls a real AI provider and never spends real money.
 * It only writes a row describing a SIMULATED test — see the header of
 * api/_lib/loadtest-engine.js and api/cron-loadtest-tick.js for the full
 * explanation of why, and how that's enforced.
 * ══════════════════════════════════════════════════════════════════════════
 */

'use strict';

const { withFailureReporting } = require('./_lib/report-failure.js');
const { requireInternalToolsAccess } = require('./_lib/internal-tools-access-token.js');
const { sbRest } = require('./_lib/supabase-rest.js');
const { validateConfig } = require('./_lib/loadtest-engine.js');

module.exports = withFailureReporting('api/loadtest-create', async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-BuiltWith-Token');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = await requireInternalToolsAccess(req, res);
  if (!auth) return;

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: 'SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not configured.' });
  }

  const validation = validateConfig(req.body || {});
  if (!validation.ok) {
    return res.status(400).json({ error: validation.error, code: 'invalid_config' });
  }

  const activeResp = await sbRest(supabaseUrl, serviceKey, 'GET',
    '/load_test_runs?status=in.(running,paused)&select=id,status,started_at&limit=1');
  if (!activeResp.ok) {
    return res.status(502).json({ error: 'Could not check for an active run', detail: activeResp.data });
  }
  const active = (activeResp.data || [])[0];
  if (active) {
    return res.status(409).json({
      error: `A load test is already ${active.status} (run ${active.id}, started ${active.started_at}). ` +
             'Pause or cancel it before starting a new one.',
      code: 'run_already_active',
      activeRunId: active.id,
    });
  }

  const now = new Date();
  const endsAt = new Date(now.getTime() + validation.config.durationDays * 24 * 60 * 60 * 1000);

  const insertResp = await sbRest(supabaseUrl, serviceKey, 'POST', '/load_test_runs', [{
    created_by: auth.userId,
    status: 'running',
    config: validation.config,
    started_at: now.toISOString(),
    ends_at: endsAt.toISOString(),
    last_tick_at: now.toISOString(),
  }]);
  if (!insertResp.ok) {
    return res.status(502).json({ error: 'Could not create the run', detail: insertResp.data });
  }

  const run = (insertResp.data || [])[0];
  return res.status(200).json({ success: true, run });
});
