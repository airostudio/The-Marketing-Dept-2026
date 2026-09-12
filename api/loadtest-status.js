/**
 * api/loadtest-status.js — read endpoint for the Load Testing Agent
 * dashboard (web/tools/load-testing.html).
 *
 * GET ?runId=<uuid>   — that run's status + stats + recent snapshots
 * GET (no runId)      — the current active run if any, else the most recent
 *
 * Returns: { run, snapshots, history }
 *   run        — the run row (config, status, running counters, timestamps)
 *   snapshots  — up to 500 most recent snapshot rows, oldest first, for the
 *                dashboard's time-series charts
 *   history    — id/status/config-summary/final-stats for past runs
 *
 * Same two-layer gate as every other loadtest-*.js endpoint.
 */

'use strict';

const { withFailureReporting } = require('./_lib/report-failure.js');
const { requireInternalToolsAccess } = require('./_lib/internal-tools-access-token.js');
const { sbRest, isUuid } = require('./_lib/supabase-rest.js');

const SNAPSHOT_PAGE_SIZE = 500;
const HISTORY_LIMIT = 25;

module.exports = withFailureReporting('api/loadtest-status', async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-BuiltWith-Token');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const auth = await requireInternalToolsAccess(req, res);
  if (!auth) return;

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: 'SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not configured.' });
  }

  const runId = req.query && req.query.runId;
  let run = null;

  if (runId) {
    if (!isUuid(runId)) return res.status(400).json({ error: 'runId must be a uuid' });
    const r = await sbRest(supabaseUrl, serviceKey, 'GET', `/load_test_runs?id=eq.${runId}&limit=1`);
    if (!r.ok) return res.status(502).json({ error: 'Could not look up the run', detail: r.data });
    run = (r.data || [])[0] || null;
  } else {
    const active = await sbRest(supabaseUrl, serviceKey, 'GET',
      '/load_test_runs?status=in.(running,paused)&order=started_at.desc&limit=1');
    if (!active.ok) return res.status(502).json({ error: 'Could not look up active run', detail: active.data });
    run = (active.data || [])[0] || null;
    if (!run) {
      const recent = await sbRest(supabaseUrl, serviceKey, 'GET',
        '/load_test_runs?order=created_at.desc&limit=1');
      if (recent.ok) run = (recent.data || [])[0] || null;
    }
  }

  let snapshots = [];
  if (run) {
    const snapResp = await sbRest(supabaseUrl, serviceKey, 'GET',
      `/load_test_snapshots?run_id=eq.${run.id}&order=snapshot_at.desc&limit=${SNAPSHOT_PAGE_SIZE}`);
    if (snapResp.ok) snapshots = (snapResp.data || []).reverse(); // oldest first for charting
  }

  const historyResp = await sbRest(supabaseUrl, serviceKey, 'GET',
    `/load_test_runs?order=created_at.desc&limit=${HISTORY_LIMIT}&select=id,status,config,calibration_result,started_at,ends_at,last_tick_at,jobs_requested_total,jobs_succeeded_total,jobs_failed_total,errors_by_category,total_cost_usd,peak_concurrent_vus,peak_concurrent_builds,peak_queue_depth,created_at`);
  const history = historyResp.ok ? (historyResp.data || []) : [];

  return res.status(200).json({ run, snapshots, history });
});
