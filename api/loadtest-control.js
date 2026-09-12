/**
 * api/loadtest-control.js — pause / resume / cancel a Load Testing Agent run.
 *
 * POST { runId, action: 'pause' | 'resume' | 'cancel' }
 * Returns: { success, run }
 *
 * Same two-layer gate as every other loadtest-*.js endpoint: normal Audema
 * login AND the internal-tools unlock token (requireInternalToolsAccess).
 *
 * Pausing stops api/cron-loadtest-tick.js from creating new arrivals or
 * promoting queued jobs to running for this run (already-running jobs are
 * left to finish, per the task spec — a hard stop would just discard
 * simulated work in flight for no benefit). Resuming picks back up.
 * Cancelling marks the run 'cancelled'; the tick then ignores it entirely
 * (its top-of-tick query only looks at running/paused runs).
 */

'use strict';

const { withFailureReporting } = require('./_lib/report-failure.js');
const { requireInternalToolsAccess } = require('./_lib/internal-tools-access-token.js');
const { sbRest, isUuid } = require('./_lib/supabase-rest.js');

const TRANSITIONS = {
  pause:  { from: ['running'], to: 'paused' },
  resume: { from: ['paused'], to: 'running' },
  cancel: { from: ['running', 'paused', 'draft'], to: 'cancelled' },
};

module.exports = withFailureReporting('api/loadtest-control', async function handler(req, res) {
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

  const { runId, action } = req.body || {};
  if (!isUuid(runId)) return res.status(400).json({ error: 'runId (uuid) is required' });
  const transition = TRANSITIONS[action];
  if (!transition) return res.status(400).json({ error: "action must be 'pause', 'resume', or 'cancel'" });

  const runResp = await sbRest(supabaseUrl, serviceKey, 'GET', `/load_test_runs?id=eq.${runId}&limit=1`);
  if (!runResp.ok) return res.status(502).json({ error: 'Could not look up the run', detail: runResp.data });
  const run = (runResp.data || [])[0];
  if (!run) return res.status(404).json({ error: 'Run not found' });

  if (!transition.from.includes(run.status)) {
    return res.status(409).json({
      error: `Cannot ${action} a run that is '${run.status}' (expected one of: ${transition.from.join(', ')})`,
      code: 'invalid_transition',
    });
  }

  const patchResp = await sbRest(supabaseUrl, serviceKey, 'PATCH', `/load_test_runs?id=eq.${runId}`, {
    status: transition.to,
  });
  if (!patchResp.ok) return res.status(502).json({ error: 'Could not update the run', detail: patchResp.data });

  const updated = (patchResp.data || [])[0];
  return res.status(200).json({ success: true, run: updated });
});
