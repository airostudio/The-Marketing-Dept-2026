/**
 * api/cron-loadtest-tick.js — the Load Testing Agent's simulation engine.
 *
 * Triggered by Vercel Cron (see vercel.json's "crons" entry). Vercel
 * serverless functions cannot hold a 5-day process open, so the whole test
 * is modeled as STATE IN SUPABASE, advanced one discrete step per tick —
 * like a game simulation stepping forward each frame, never an in-memory
 * loop or blocking wait. Each invocation:
 *
 *   1. Finds the one 'running' run (at most one exists at a time — enforced
 *      by api/loadtest-create.js). No-ops cheaply if there isn't one.
 *   2. Completes the run if its duration has elapsed.
 *   3. Computes new "arrivals" (simulated generation requests) since the
 *      last tick and inserts them as queued jobs, split across the 6
 *      configured personas.
 *   4. Promotes queued jobs to running up to generationConcurrency, and
 *      PRE-COMPUTES each one's entire outcome right away (success/failure,
 *      duration, cost) — this is a discrete-event simulation, not something
 *      that waits on a real timer or a real API call.
 *   5. Finalizes running jobs whose precomputed finish time has arrived.
 *   6. Writes one snapshot row for the dashboard's time-series charts.
 *   7. Prunes old finished job rows so the table stays bounded regardless
 *      of how long the run has been going.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * NON-NEGOTIABLE SAFETY CONSTRAINT: every job simulated here is entirely
 * synthetic. This file makes exactly one kind of outbound network call —
 * to this app's own Supabase project (SUPABASE_URL) — and never calls out
 * to Anthropic's, OpenAI's, or Google's generative-AI APIs, or any other AI
 * provider. "successes," "failures," "durations," and "costs"
 * are all drawn from formulas and constants in api/_lib/loadtest-engine.js.
 * costPerGenerationUsd is a configured constant, not a real API bill. There
 * is no "real mode" toggle anywhere in this feature, by design — see the
 * header of api/_lib/loadtest-engine.js.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Cron interval chosen: every 1 minute (see vercel.json). This repo's
 * existing crons range from every 15 minutes to weekly, so there's no
 * existing precedent in this account for anything tighter — 1 minute is
 * what the simulation wants for a responsive dashboard (concurrency and
 * queue depth genuinely change minute to minute over a multi-day run), but
 * if this Vercel account's plan rejects a 1-minute cron, drop this one line
 * in vercel.json to run every 5 minutes instead (cron schedule string omitted here to avoid closing this comment block); nothing else about the
 * tick logic depends on the exact interval — it always measures real
 * elapsed time via last_tick_at rather than assuming a fixed step, so a
 * slower cron just means chunkier, still-correct steps.
 *
 * Required env vars:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY — data access (service role,
 *     same pattern as api/cron-auto-publish.js / api/cron-agent-audit.js)
 *   CRON_SECRET — Vercel sends `Authorization: Bearer <CRON_SECRET>` on its
 *     own scheduled invocations once this is set; anything else is rejected.
 */

'use strict';

const { withFailureReporting } = require('./_lib/report-failure.js');
const { sbRest } = require('./_lib/supabase-rest.js');
const engine = require('./_lib/loadtest-engine.js');

/** Cap on job promotions/finalizations processed per tick, so a long gap
 * between ticks (e.g. after a deploy pause) never causes one invocation to
 * do a huge burst of work — subsequent ticks catch up gradually instead. */
const MAX_PROMOTIONS_PER_TICK = 300;
const MAX_FINALIZATIONS_PER_TICK = 300;

/** How many recently-finished jobs to compute percentiles over. Documented
 * choice: the last N finished jobs (rather than "since last snapshot", which
 * would make percentiles noisy at low arrival rates) gives a stable, still-
 * recent picture of the run's current latency shape. */
const PERCENTILE_WINDOW = 500;

/** Finished job rows older than this are pruned each tick — snapshots are
 * the durable long-term record, raw jobs are working state only. 2 hours
 * comfortably covers the PERCENTILE_WINDOW even at high arrival rates while
 * keeping the table's size bounded regardless of how long the run runs. */
const JOB_RETENTION_MS = 2 * 60 * 60 * 1000;

module.exports = withFailureReporting('api/cron-loadtest-tick', async function handler(req, res) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return res.status(500).json({ error: 'CRON_SECRET is not configured — refusing to run an unauthenticated load-test tick.' });
  }
  if (req.headers['authorization'] !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: 'SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not configured.' });
  }

  // Paused runs are still ticked (finalizing already-running jobs, keeping
  // last_tick_at fresh) — just never given new arrivals or promotions, see
  // the `run.status === 'running'` guards below. This also means resuming a
  // paused run does not create a false "gap" that dumps a huge arrival burst.
  const runResp = await sbRest(supabaseUrl, serviceKey, 'GET',
    '/load_test_runs?status=in.(running,paused)&order=started_at.asc&limit=1');
  if (!runResp.ok) return res.status(502).json({ error: 'Could not query load_test_runs', detail: runResp.data });

  const run = (runResp.data || [])[0];
  if (!run) return res.status(200).json({ ok: true, active: false });

  const now = new Date();
  const config = run.config;
  const startedAt = new Date(run.started_at);
  const endsAt = new Date(run.ends_at);
  const totalMs = endsAt.getTime() - startedAt.getTime();

  // ── Step 2: complete the run if its duration has elapsed ────────────────
  if (now >= endsAt) {
    await finalizeSnapshotAndComplete(supabaseUrl, serviceKey, run, now);
    return res.status(200).json({ ok: true, active: true, completed: true, runId: run.id });
  }

  const elapsedMs = now.getTime() - startedAt.getTime();
  const lastTickAt = run.last_tick_at ? new Date(run.last_tick_at) : startedAt;
  const minutesSinceLastTick = Math.max(0, (now.getTime() - lastTickAt.getTime()) / 60000);

  const activeVUs = engine.activeVirtualUsers(elapsedMs, totalMs, config);

  const summary = { runId: run.id, activeVUs, arrivals: 0, promoted: 0, finalized: 0, pruned: 0 };

  // ── Step 3: arrivals ──────────────────────────────────────────────────────
  if (run.status === 'running' && minutesSinceLastTick > 0) {
    const arrivals = engine.computeArrivals(activeVUs, minutesSinceLastTick);
    summary.arrivals = arrivals;
    if (arrivals > 0) {
      const byPersona = engine.splitByPersonaMix(arrivals, config.personaMix);
      const rows = [];
      for (const persona of engine.PERSONA_KEYS) {
        const n = byPersona[persona] || 0;
        for (let i = 0; i < n; i++) rows.push({ run_id: run.id, persona, status: 'queued' });
      }
      if (rows.length) {
        const ins = await sbRest(supabaseUrl, serviceKey, 'POST', '/load_test_jobs', rows);
        if (!ins.ok) return res.status(502).json({ error: 'Could not insert arrivals', detail: ins.data });
      }
    }
  }

  // ── Step 4: promote queued → running, precomputing outcomes ─────────────
  const runningResp = await sbRest(supabaseUrl, serviceKey, 'GET',
    `/load_test_jobs?run_id=eq.${run.id}&status=eq.running&select=id`);
  if (!runningResp.ok) return res.status(502).json({ error: 'Could not count running jobs', detail: runningResp.data });
  let concurrentBuilds = (runningResp.data || []).length;

  if (run.status === 'running') {
    const slots = Math.max(0, Math.min(MAX_PROMOTIONS_PER_TICK, config.generationConcurrency - concurrentBuilds));
    if (slots > 0) {
      const queuedResp = await sbRest(supabaseUrl, serviceKey, 'GET',
        `/load_test_jobs?run_id=eq.${run.id}&status=eq.queued&order=queued_at.asc&limit=${slots}&select=id`);
      if (!queuedResp.ok) return res.status(502).json({ error: 'Could not fetch queued jobs', detail: queuedResp.data });
      const toPromote = queuedResp.data || [];
      for (const job of toPromote) {
        const outcome = engine.simulateJobOutcome(config);
        const startedAtIso = now.toISOString();
        const finishAt = new Date(now.getTime() + outcome.durationMs);
        const patch = await sbRest(supabaseUrl, serviceKey, 'PATCH', `/load_test_jobs?id=eq.${job.id}`, {
          status: 'running',
          started_at: startedAtIso,
          expected_finish_at: finishAt.toISOString(),
          failure_category: outcome.success ? null : outcome.failureCategory,
          simulated_cost_usd: config.costPerGenerationUsd,
          // Stash the precomputed success/fail verdict in duration_ms's sign
          // would be a hack; instead we just re-derive it at finalize time
          // from failure_category (null => success), which is set above.
        });
        if (patch.ok) {
          concurrentBuilds++;
          summary.promoted++;
        }
      }
    }
  }

  // ── Step 5: finalize running jobs whose precomputed finish time has arrived ─
  const dueResp = await sbRest(supabaseUrl, serviceKey, 'GET',
    `/load_test_jobs?run_id=eq.${run.id}&status=eq.running&expected_finish_at=lte.${encodeURIComponent(now.toISOString())}&order=expected_finish_at.asc&limit=${MAX_FINALIZATIONS_PER_TICK}`);
  if (!dueResp.ok) return res.status(502).json({ error: 'Could not fetch due jobs', detail: dueResp.data });

  const dueJobs = dueResp.data || [];
  let newlySucceeded = 0, newlyFailed = 0;
  const newErrorsByCategory = {};
  let newCost = 0;

  for (const job of dueJobs) {
    const finishedAtIso = now.toISOString();
    const startedAtMs = new Date(job.started_at).getTime();
    const durationMs = Math.max(0, now.getTime() - startedAtMs);
    const finalStatus = job.failure_category ? 'failed' : 'succeeded';
    const patch = await sbRest(supabaseUrl, serviceKey, 'PATCH', `/load_test_jobs?id=eq.${job.id}`, {
      status: finalStatus,
      finished_at: finishedAtIso,
      duration_ms: durationMs,
    });
    if (!patch.ok) continue;
    summary.finalized++;
    concurrentBuilds--;
    if (finalStatus === 'succeeded') {
      newlySucceeded++;
      newCost += Number(job.simulated_cost_usd || config.costPerGenerationUsd);
    } else {
      newlyFailed++;
      newErrorsByCategory[job.failure_category] = (newErrorsByCategory[job.failure_category] || 0) + 1;
      // A failed generation still cost something to attempt in the real
      // pipeline this models — keep the synthetic cost consistent whether
      // the job succeeded or not, matching "Total test AI cost" in the
      // example dashboard, which is not scoped to successes only.
      newCost += Number(job.simulated_cost_usd || config.costPerGenerationUsd);
    }
  }

  // ── Step 6: running counters + one snapshot row ──────────────────────────
  const queueDepthResp = await sbRest(supabaseUrl, serviceKey, 'GET',
    `/load_test_jobs?run_id=eq.${run.id}&status=eq.queued&select=id`);
  const queueDepth = queueDepthResp.ok ? (queueDepthResp.data || []).length : 0;

  const mergedErrors = Object.assign({}, run.errors_by_category || {});
  for (const [cat, n] of Object.entries(newErrorsByCategory)) mergedErrors[cat] = (mergedErrors[cat] || 0) + n;

  const jobsRequestedTotal = Number(run.jobs_requested_total || 0) + summary.arrivals;
  const jobsSucceededTotal = Number(run.jobs_succeeded_total || 0) + newlySucceeded;
  const jobsFailedTotal = Number(run.jobs_failed_total || 0) + newlyFailed;
  const totalCostUsd = Number(run.total_cost_usd || 0) + newCost;

  // Percentiles over a recent window of finished jobs (see PERCENTILE_WINDOW).
  const recentFinishedResp = await sbRest(supabaseUrl, serviceKey, 'GET',
    `/load_test_jobs?run_id=eq.${run.id}&status=in.(succeeded,failed)&duration_ms=not.is.null&order=finished_at.desc&limit=${PERCENTILE_WINDOW}&select=duration_ms`);
  const recentDurations = recentFinishedResp.ok ? (recentFinishedResp.data || []).map(r => r.duration_ms).filter(n => Number.isFinite(n)) : [];

  const peakConcurrentVus = Math.max(Number(run.peak_concurrent_vus || 0), activeVUs);
  const peakConcurrentBuilds = Math.max(Number(run.peak_concurrent_builds || 0), concurrentBuilds);
  const peakQueueDepth = Math.max(Number(run.peak_queue_depth || 0), queueDepth);

  await sbRest(supabaseUrl, serviceKey, 'POST', '/load_test_snapshots', [{
    run_id: run.id,
    concurrent_vus: activeVUs,
    concurrent_builds: concurrentBuilds,
    queue_depth: queueDepth,
    jobs_requested_total: jobsRequestedTotal,
    jobs_succeeded_total: jobsSucceededTotal,
    jobs_failed_total: jobsFailedTotal,
    p50_ms: engine.percentile(recentDurations, 50),
    p95_ms: engine.percentile(recentDurations, 95),
    p99_ms: engine.percentile(recentDurations, 99),
    errors_by_category: mergedErrors,
    total_cost_usd: Number(totalCostUsd.toFixed(2)),
  }]);

  await sbRest(supabaseUrl, serviceKey, 'PATCH', `/load_test_runs?id=eq.${run.id}`, {
    last_tick_at: now.toISOString(),
    jobs_requested_total: jobsRequestedTotal,
    jobs_succeeded_total: jobsSucceededTotal,
    jobs_failed_total: jobsFailedTotal,
    errors_by_category: mergedErrors,
    total_cost_usd: Number(totalCostUsd.toFixed(2)),
    peak_concurrent_vus: peakConcurrentVus,
    peak_concurrent_builds: peakConcurrentBuilds,
    peak_queue_depth: peakQueueDepth,
  });

  // ── Step 7: prune old finished jobs so the table stays bounded ─────────
  const cutoff = new Date(now.getTime() - JOB_RETENTION_MS).toISOString();
  const pruneResp = await sbRest(supabaseUrl, serviceKey, 'DELETE',
    `/load_test_jobs?run_id=eq.${run.id}&status=in.(succeeded,failed)&finished_at=lt.${encodeURIComponent(cutoff)}`);
  summary.pruned = (pruneResp.ok && Array.isArray(pruneResp.data)) ? pruneResp.data.length : 0;

  return res.status(200).json({ ok: true, active: true, ...summary, queueDepth, concurrentBuilds });
});

/** Write one final snapshot (so the dashboard has an end-state data point)
 * and mark the run completed. */
async function finalizeSnapshotAndComplete(supabaseUrl, serviceKey, run, now) {
  const queueDepthResp = await sbRest(supabaseUrl, serviceKey, 'GET',
    `/load_test_jobs?run_id=eq.${run.id}&status=eq.queued&select=id`);
  const runningResp = await sbRest(supabaseUrl, serviceKey, 'GET',
    `/load_test_jobs?run_id=eq.${run.id}&status=eq.running&select=id`);
  const recentFinishedResp = await sbRest(supabaseUrl, serviceKey, 'GET',
    `/load_test_jobs?run_id=eq.${run.id}&status=in.(succeeded,failed)&duration_ms=not.is.null&order=finished_at.desc&limit=${PERCENTILE_WINDOW}&select=duration_ms`);
  const recentDurations = recentFinishedResp.ok ? (recentFinishedResp.data || []).map(r => r.duration_ms).filter(n => Number.isFinite(n)) : [];

  await sbRest(supabaseUrl, serviceKey, 'POST', '/load_test_snapshots', [{
    run_id: run.id,
    concurrent_vus: 0,
    concurrent_builds: runningResp.ok ? (runningResp.data || []).length : 0,
    queue_depth: queueDepthResp.ok ? (queueDepthResp.data || []).length : 0,
    jobs_requested_total: run.jobs_requested_total || 0,
    jobs_succeeded_total: run.jobs_succeeded_total || 0,
    jobs_failed_total: run.jobs_failed_total || 0,
    p50_ms: engine.percentile(recentDurations, 50),
    p95_ms: engine.percentile(recentDurations, 95),
    p99_ms: engine.percentile(recentDurations, 99),
    errors_by_category: run.errors_by_category || {},
    total_cost_usd: run.total_cost_usd || 0,
  }]);

  await sbRest(supabaseUrl, serviceKey, 'PATCH', `/load_test_runs?id=eq.${run.id}`, {
    status: 'completed',
    last_tick_at: now.toISOString(),
  });
}
