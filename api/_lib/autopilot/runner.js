/**
 * api/_lib/autopilot/runner.js — runs agent work with nobody watching.
 *
 * Every few minutes (api/cron-autopilot.js):
 *   1. Each autopilot that is due gets a new job (unless one is still open
 *      or its connection needs the business's attention), and its next run
 *      is scheduled.
 *   2. Due jobs run one step at a time. A step returns what happens next:
 *        { next, state }            go on to the next step
 *        { wait: 'approval', … }    stop until the business approves
 *        { wait: 'permission', … }  stop until the business connects/reconnects something
 *        { later: ms, state, note } nothing to do yet; look again later
 *        { done: result, event? }   finished
 *      A step that throws is handled by faults.js (an error may carry
 *      .stateUpdate: progress made before it failed, kept for the retry): retried with growing
 *      waits, slowed down for rate limits, or stopped with a request for a
 *      login. Every repair is written on the job, and when the job finishes
 *      after repairs the business is told what went wrong and what was done.
 *
 * Handlers live in registry.js, one per job kind, so every agent shares this.
 */

'use strict';

const faults = require('./faults.js');
const activity = require('./activity.js');
const { nextRunAt } = require('./schedule.js');
const settings = require('../settings.js');

const OPEN = ['queued', 'running', 'waiting_approval', 'waiting_permission'];
const LOCK_MS = 4 * 60 * 1000;
const MAX_STEPS_PER_RUN = 6;
const iso = (t) => new Date(t).toISOString();

/** Create jobs for autopilots that are due. */
async function scheduleDue(sb, deps) {
  const now = deps.now();
  const registry = deps.registry;
  const r = await sb('GET', `/autopilots?enabled=eq.true&next_run_at=lte.${encodeURIComponent(iso(now))}&select=*&order=next_run_at.asc&limit=50`);
  if (!r.ok) return { scheduled: 0 };
  let scheduled = 0;
  for (const ap of r.data || []) {
    const next = iso(nextRunAt(ap.cadence, new Date(now)));
    const handler = registry.forAgent(ap.agent);
    if (!handler) { await sb('PATCH', `/autopilots?id=eq.${ap.id}`, { next_run_at: next }); continue; }
    // One piece of work at a time per autopilot.
    const open = await sb('GET', `/agent_jobs?autopilot_id=eq.${ap.id}&status=in.(${OPEN.join(',')})&select=id&limit=1`);
    if (open.ok && (open.data || []).length) { await sb('PATCH', `/autopilots?id=eq.${ap.id}`, { next_run_at: next }); continue; }
    if (ap.connection_id) {
      const c = await sb('GET', `/connections?id=eq.${ap.connection_id}&select=status,label,provider&limit=1`);
      const conn = c.ok && c.data && c.data[0];
      if (conn && conn.status !== 'active') {
        await sb('PATCH', `/autopilots?id=eq.${ap.id}`, { next_run_at: next, paused_reason: `Waiting for ${conn.label || conn.provider} to be reconnected.` });
        continue;
      }
    }
    const job = await sb('POST', '/agent_jobs', { user_id: ap.user_id, autopilot_id: ap.id, agent: ap.agent, kind: handler.kind, step: handler.firstStep, state: {}, status: 'queued', run_at: iso(now) });
    if (job.ok) scheduled++;
    await sb('PATCH', `/autopilots?id=eq.${ap.id}`, { next_run_at: next, last_run_at: iso(now), paused_reason: null });
  }
  return { scheduled };
}

function scopeOf(ap) { return ap ? { intel_profile_id: ap.intel_profile_id || null, project_id: ap.project_id || null } : {}; }

/** Run one job as far as it will go in this call. */
async function runJob(sb, jobRow, deps) {
  const now = deps.now;
  const claim = await sb('PATCH', `/agent_jobs?id=eq.${jobRow.id}&status=eq.queued&or=(lock_until.is.null,lock_until.lt.${encodeURIComponent(iso(now()))})`, { status: 'running', lock_until: iso(now() + LOCK_MS) });
  if (!claim.ok || !claim.data || !claim.data[0]) return { ran: false };
  let job = claim.data[0];
  const handler = deps.registry.forKind(job.kind);
  const apRes = job.autopilot_id ? await sb('GET', `/autopilots?id=eq.${job.autopilot_id}&select=*&limit=1`) : null;
  const autopilot = apRes && apRes.ok && apRes.data && apRes.data[0] || null;
  const base = { user_id: job.user_id, agent: job.agent, job_id: job.id, ...scopeOf(autopilot) };
  const save = async (patch) => { const u = await sb('PATCH', `/agent_jobs?id=eq.${job.id}`, patch); if (u.ok && u.data && u.data[0]) job = u.data[0]; };
  const tell = (ev) => activity.record(sb, { ...base, ...ev }, deps);

  if (!handler) {
    await save({ status: 'failed', lock_until: null, last_error: `No handler for job kind "${job.kind}".`, finished_at: iso(now()) });
    return { ran: true, status: 'failed' };
  }

  for (let i = 0; i < MAX_STEPS_PER_RUN; i++) {
    // Slow steps (an image, a long article) each get a fresh run rather than overrunning this one.
    if (i > 0 && deps.deadline && now() > deps.deadline) break;
    const stepFn = handler.steps[job.step];
    if (!stepFn) { await save({ status: 'failed', lock_until: null, last_error: `Unknown step "${job.step}".`, finished_at: iso(now()) }); return { ran: true, status: 'failed' }; }
    let out;
    try {
      out = await stepFn({ job, state: job.state || {}, sb, autopilot, now, deps, tell });
    } catch (err) {
      // Work a step finished before it failed (e.g. fixes already applied) is kept, so a retry doesn't redo it.
      if (err && err.stateUpdate) await save({ state: { ...(job.state || {}), ...err.stateUpdate } });
      const { kind, retryAfterMs } = faults.classify(err);
      // A step that made progress before pausing (e.g. a daily send limit) hasn't failed: its tries start over.
      const attempt = err && err.progressed ? 0 : (job.step_attempts || 0);
      const decision = faults.decide(kind, attempt, retryAfterMs);
      const problem = faults.describe(kind, err);
      if (decision.action === 'retry') {
        const repairs = [...(job.repairs || []), { at: iso(now()), step: job.step, problem, fix: `${decision.fix} (in ${Math.round(decision.waitMs / 60000)} min)` }].slice(-30);
        await save({ status: 'queued', lock_until: null, step_attempts: err && err.progressed ? 0 : (job.step_attempts || 0) + 1, run_at: iso(now() + decision.waitMs), last_error: problem, repairs });
        return { ran: true, status: 'retrying', kind };
      }
      if (decision.action === 'ask_permission') {
        const connId = err.connectionId || (autopilot && autopilot.connection_id) || null;
        if (connId) await sb('PATCH', `/connections?id=eq.${connId}`, { status: 'needs_attention', status_note: problem, last_error_at: iso(now()) });
        await save({ status: 'waiting_permission', lock_until: null, last_error: problem, state: { ...(job.state || {}), waitingFor: connId } });
        await tell({ kind: 'needs_permission', title: `${handler.label} needs you to reconnect ${err.connectionLabel || 'an account'}`, body: `${problem}.\n\nNothing was changed. Reconnect it under Connections and the work carries on from where it stopped.`, action: { type: 'reconnect', connectionId: connId } });
        return { ran: true, status: 'waiting_permission' };
      }
      // Gave up: say what was tried.
      const tried = (job.repairs || []).filter(r => r.step === job.step).map(r => `• ${r.problem} — ${r.fix}`).join('\n');
      await save({ status: 'failed', lock_until: null, last_error: problem, finished_at: iso(now()) });
      await tell({ kind: 'failed', title: `${handler.label} couldn't finish: ${handler.stepLabel ? handler.stepLabel(job.step) : job.step}`, body: `${problem}. ${decision.reason}${tried ? `\n\nWhat was tried:\n${tried}` : ''}\n\nNothing was published. It will try again at the next scheduled run.`, details: { kind } });
      if (kind === 'not_configured' && deps.reportFailure) deps.reportFailure({ source: `autopilot/${job.kind}`, message: problem });
      return { ran: true, status: 'failed', kind };
    }

    const state = { ...(job.state || {}), ...(out.state || {}) };
    if (out.next) { await save({ step: out.next, state, step_attempts: 0, last_error: null }); continue; }
    if (out.later) { await save({ state, status: 'queued', lock_until: null, run_at: iso(now() + out.later) }); return { ran: true, status: 'later' }; }
    if (out.wait === 'approval' || out.wait === 'permission') {
      // Waiting for the business in general, not for one login to be reconnected.
      state.waitingFor = null;
      await save({ state, status: out.wait === 'approval' ? 'waiting_approval' : 'waiting_permission', lock_until: null, step: out.resume || job.step, step_attempts: 0 });
      if (out.event) await tell({ kind: out.wait === 'approval' ? 'needs_approval' : 'needs_permission', ...out.event });
      return { ran: true, status: `waiting_${out.wait}` };
    }
    if ('done' in out) {
      await save({ state, status: 'done', lock_until: null, last_error: null, result: out.done || {}, finished_at: iso(now()) });
      if (out.event) await tell({ kind: 'done', ...out.event });
      const repairs = job.repairs || [];
      if (repairs.length) {
        await tell({ kind: 'repaired', title: `${handler.label} fixed ${repairs.length} problem${repairs.length === 1 ? '' : 's'} on the way`, body: repairs.map(r => `• ${r.problem} — ${r.fix}`).join('\n'), details: { repairs } });
      }
      return { ran: true, status: 'done' };
    }
    throw new Error(`Step "${job.step}" returned nothing the runner understands.`);
  }
  await save({ status: 'queued', lock_until: null, run_at: iso(now()) });
  return { ran: true, status: 'continuing' };
}

/** One cron tick: schedule due autopilots, then run due jobs until time runs out. */
async function tick(sb, deps) {
  // Functions get 150s; the slowest step (one of Nancy's days) can take ~100s, so nothing new starts after ~40s.
  const d = { now: Date.now, budgetMs: 100000, ...deps };
  const started = d.now();
  if (!d.deadline) d.deadline = started + d.budgetMs - 60000;   // no new step starts with under a minute left
  const sched = await scheduleDue(sb, d);
  const due = await sb('GET', `/agent_jobs?status=eq.queued&run_at=lte.${encodeURIComponent(iso(d.now()))}&select=*&order=run_at.asc&limit=25`);
  const ran = [];
  for (const job of (due.ok && due.data) || []) {
    if (d.now() - started > d.budgetMs - 60000) break;   // never start a job with under a minute left
    // Each job runs with its owner's client settings (their own keys, sender, sign-in apps).
    try { ran.push({ id: job.id, ...(await settings.runAs(job.user_id, () => runJob(sb, job, d))) }); }
    catch (e) { ran.push({ id: job.id, ran: false, error: e.message }); }
  }
  return { scheduled: sched.scheduled, ran };
}

module.exports = { tick, runJob, scheduleDue, OPEN };
