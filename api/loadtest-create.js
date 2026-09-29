/**
 * api/loadtest-create.js — start a new Load Testing Agent run.
 *
 * POST { virtualUsers, durationDays, personaMix, generationConcurrency,
 *        spike, artificialAiDelay, apiFailureInjection, costPerGenerationUsd,
 *        calibration?: { enabled, businessName, industry?, usdPerCredit? } }
 * Returns: { success, run, calibration? }
 *   or, when calibration was requested and its one real call failed:
 *   402/502 { error, code: 'calibration_failed', calibrationResult }
 *   (no run is created — see the "refuse by default" section below)
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
 * This endpoint runs a purely SIMULATED test — no real AI call, no real
 * spend — UNLESS the caller opts into calibration (body.calibration.enabled),
 * in which case it makes EXACTLY ONE real, disclosed, credit-spending call
 * (via api/_lib/loadtest-calibration.js, which itself only ever calls INTO
 * the existing api/generate-website-mockup.js — see that file's header for
 * why this is safe and narrowly scoped) to measure real latency and real
 * cost, then uses those two real numbers to parameterize the simulation.
 * Every one of the run's own 24,820+ simulated jobs remains pure math in
 * api/_lib/loadtest-engine.js, executed with zero network calls by
 * api/cron-loadtest-tick.js, exactly as before this feature existed — see
 * the header of that file and of loadtest-engine.js.
 * ══════════════════════════════════════════════════════════════════════════
 */

'use strict';

const { withFailureReporting, reportFailureAsync } = require('./_lib/report-failure.js');
const { requireInternalToolsAccess } = require('./_lib/internal-tools-access-token.js');
const { sbRest } = require('./_lib/supabase-rest.js');
const { validateConfig, computeCalibratedMuSeconds } = require('./_lib/loadtest-engine.js');
const { runCalibration } = require('./_lib/loadtest-calibration.js');

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

  // ── Optional calibration: ONE real call, made and disclosed before the
  // simulated run itself ever starts ──────────────────────────────────────
  const calibrationRequest = req.body && req.body.calibration;
  const config = validation.config;
  let calibrationResult = null;

  if (calibrationRequest && calibrationRequest.enabled) {
    const businessName = String(calibrationRequest.businessName || '').trim();
    if (!businessName) {
      return res.status(400).json({ error: 'calibration.businessName is required when calibration is enabled', code: 'invalid_config' });
    }

    calibrationResult = await runCalibration(req, {
      businessName,
      industry: calibrationRequest.industry ? String(calibrationRequest.industry).trim() : '',
      targetUrl: calibrationRequest.targetUrl ? String(calibrationRequest.targetUrl).trim() : '',
    });

    if (!calibrationResult.success) {
      // Refuse to start by default — see the task's own rule: a simulation
      // parameterized off a currently-broken real pipeline would be
      // misleading. The ONLY way past this is the caller explicitly
      // resubmitting with calibration.enabled left off entirely (the UI's
      // "Start without calibration" button does exactly that) — never an
      // automatic fallback from here.
      return res.status(502).json({
        error: `The real calibration build failed (${calibrationResult.failureMessage}) — starting a ` +
               'simulation on top of a currently-broken real pipeline would be misleading. Fix the ' +
               'underlying issue, or explicitly start without calibration (fully synthetic, as before).',
        code: 'calibration_failed',
        calibrationResult,
      });
    }

    // Success: derive this run's simulation parameters from the two real
    // measured numbers, per loadtest-engine.js's documented formulas.
    // costPerGenerationUsd is REUSED (not renamed) to carry whichever unit
    // config.costUnit now names — see the long comment on that field in
    // loadtest-engine.js's validateConfig, and in supabase-load-testing.sql.
    config.artificialAiDelay.muSeconds = computeCalibratedMuSeconds(calibrationResult.realLatencyMs);
    config.costUnit = 'credits';
    config.costPerGenerationUsd = Number.isFinite(calibrationResult.realCreditsUsed) ? calibrationResult.realCreditsUsed : config.costPerGenerationUsd;
    config.usdPerCredit = (calibrationRequest.usdPerCredit !== undefined && calibrationRequest.usdPerCredit !== null && calibrationRequest.usdPerCredit !== '')
      ? Number(calibrationRequest.usdPerCredit) : null;
    if (config.usdPerCredit !== null && !Number.isFinite(config.usdPerCredit)) config.usdPerCredit = null;
    config.calibrated = true;
  }

  const now = new Date();
  const endsAt = new Date(now.getTime() + config.durationDays * 24 * 60 * 60 * 1000);

  const insertResp = await sbRest(supabaseUrl, serviceKey, 'POST', '/load_test_runs', [{
    created_by: auth.userId,
    status: 'running',
    config,
    calibration_result: calibrationResult,
    started_at: now.toISOString(),
    ends_at: endsAt.toISOString(),
    last_tick_at: now.toISOString(),
  }]);
  if (!insertResp.ok) {
    // The most common real cause: supabase-load-testing.sql hasn't been run
    // yet, or was run before a later ALTER TABLE (e.g. calibration_result)
    // was added to it — either way, the table/column PostgREST is
    // complaining about is present in this Postgrest error, so surface it
    // instead of a generic message that gives no way to diagnose it.
    reportFailureAsync({
      source: 'api/loadtest-create',
      message: `Could not insert into load_test_runs (HTTP ${insertResp.status}): ${JSON.stringify(insertResp.data)}. ` +
               'Likely cause: supabase-load-testing.sql has not been run (or was run before a later ' +
               'ALTER TABLE was added to it) in this project\'s Supabase instance.',
      severity: 'high',
      kind: 'configuration',
    });
    const hint = insertResp.status === 404 || insertResp.status === 400
      ? ' This usually means supabase-load-testing.sql has not been run (or needs re-running) in the Supabase SQL editor.'
      : '';
    return res.status(502).json({
      error: `Could not create the run (HTTP ${insertResp.status}): ` +
             `${(insertResp.data && (insertResp.data.message || insertResp.data.error)) || JSON.stringify(insertResp.data)}.${hint}`,
    });
  }

  const run = (insertResp.data || [])[0];
  return res.status(200).json({ success: true, run });
});
