/**
 * api/cron-flow-triggers.js — enrols people into automation flows as they
 * arrive, for flows whose trigger is 'contact_created' or 'segment_entry'.
 *
 * GET /api/cron-flow-triggers            run it
 * GET /api/cron-flow-triggers?dryRun=1   report who would be enrolled, change nothing
 *
 * Bearer-gated by CRON_SECRET. Runs a few minutes before api/cron-email-flows
 * (which does the sending) so a new enrolment is picked up on its next pass.
 *
 * ── What this has to get right ───────────────────────────────────────────
 *
 *  - Activating a flow must never mail the existing audience. The first run
 *    after a flow is activated only BASELINES: it notes who is already there
 *    (contacts so far / current segment members) and enrols none of them.
 *    Only people who arrive afterwards are enrolled. Activating resets the
 *    baseline (api/email-flows.js setStatus), so a flow resumed after a long
 *    pause does not dump everything that arrived meanwhile.
 *  - 'contact_created' watches contacts.created_at past a watermark.
 *    'segment_entry' remembers who it has already seen (email_flow_trigger_seen)
 *    so entering the segment fires once per person.
 *  - Only subscribed contacts, never anyone on the account's suppression list
 *    (same list a campaign send uses; unreadable list = nobody enrolled), and
 *    never anyone who already has an enrolment in this flow, finished or not.
 *  - Bounded: MAX_ENROL_PER_FLOW per run (the rest follow next run, nothing
 *    is lost), MAX_FLOWS per run.
 *  - Contacts are matched on the flow owner's own account only.
 *
 * Required env: CRON_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

'use strict';

const { sbRest } = require('./_lib/supabase-rest.js');
const { withFailureReporting, reportFailure } = require('./_lib/report-failure.js');
const { filterSuppressed } = require('./_lib/send-guard.js');
const { resolveSegment } = require('./_lib/segment-members.js');

const MAX_FLOWS = 50;
const MAX_ENROL_PER_FLOW = 200;
const IN_CHUNK = 100;
const TRIGGERS = ['contact_created', 'segment_entry'];

const lc = (e) => String(e || '').trim().toLowerCase();
const chunks = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

/** Existing enrolments (any status) for these emails in this flow. */
async function alreadyEnrolled(sb, flowId, emails) {
  const have = new Set();
  for (const part of chunks(emails, IN_CHUNK)) {
    const r = await sb('GET', `/email_flow_enrolments?flow_id=eq.${flowId}&email=in.(${part.map(encodeURIComponent).join(',')})&select=email`);
    if (!r.ok) throw new Error(`Could not check existing enrolments (HTTP ${r.status}).`);
    (r.data || []).forEach(x => have.add(lc(x.email)));
  }
  return have;
}

async function markSeen(sb, flowId, emails) {
  for (const part of chunks(emails, 200)) {
    const rows = part.map(email => ({ flow_id: flowId, email }));
    const r = await sb('POST', '/email_flow_trigger_seen', rows);
    if (r.ok || !part.length) continue;
    // A conflict means some were already recorded (a racing run): fall back to one by one.
    for (const row of rows) {
      const one = await sb('POST', '/email_flow_trigger_seen', row);
      if (!one.ok && one.status !== 409) throw new Error(`Could not record who was seen (HTTP ${one.status}).`);
    }
  }
}

/**
 * Enrol a batch (people already filtered to this flow's eligible arrivals).
 * @returns {{enrolled:number, suppressed:number, existing:number}}
 */
async function enrolBatch(sb, flow, firstStep, people, now, dryRun) {
  const byEmail = new Map();
  people.forEach(p => { if (p.email && !byEmail.has(lc(p.email))) byEmail.set(lc(p.email), p); });
  const list = [...byEmail.values()];
  if (!list.length) return { enrolled: 0, suppressed: 0, existing: 0 };

  const supp = await filterSuppressed(flow.user_id, list.map(p => ({ to: p.email })));
  if (!supp.ok) throw new Error(supp.error || 'The suppression list could not be read.');
  const blocked = new Set(supp.suppressed.map(s => lc(s.to)));
  const have = await alreadyEnrolled(sb, flow.id, list.map(p => p.email));

  const eligible = list.filter(p => !blocked.has(lc(p.email)) && !have.has(lc(p.email)));
  let enrolled = 0;
  for (const p of eligible) {
    if (dryRun) { enrolled++; continue; }
    const r = await sb('POST', '/email_flow_enrolments', {
      flow_id: flow.id, user_id: flow.user_id, contact_id: p.id || null, email: p.email,
      next_step_order: firstStep.step_order,
      next_run_at: new Date(now.getTime() + firstStep.delay_hours * 3600000).toISOString(),
      status: 'active',
    });
    if (r.ok) enrolled++;
    else if (r.status !== 409) throw new Error(`Could not enrol ${p.email} (HTTP ${r.status}).`);
  }
  return { enrolled, suppressed: blocked.size ? list.filter(p => blocked.has(lc(p.email))).length : 0, existing: list.filter(p => have.has(lc(p.email))).length };
}

async function processFlow(sb, flow, now, dryRun) {
  const out = { flow: flow.name, trigger: flow.trigger_type, enrolled: 0, suppressed: 0, existing: 0, baselined: false };
  const setChecked = (iso) => dryRun ? Promise.resolve({ ok: true }) : sb('PATCH', `/email_flows?id=eq.${flow.id}`, { trigger_checked_at: iso });

  const stepRes = await sb('GET', `/email_flow_steps?flow_id=eq.${flow.id}&order=step_order.asc&limit=1`);
  const firstStep = stepRes.ok && stepRes.data && stepRes.data[0];
  if (!firstStep) { out.skipped = 'no_steps'; return out; }

  const runStart = now.toISOString();
  const baselining = !flow.trigger_checked_at;

  /* ── contact_created ──────────────────────────────────────────────── */
  if (flow.trigger_type === 'contact_created') {
    if (baselining) {
      const w = await setChecked(runStart);
      if (!w.ok) throw new Error(`Could not start watching (HTTP ${w.status}).`);
      out.baselined = true;
      return out;
    }
    const r = await sb('GET',
      `/contacts?user_id=eq.${flow.user_id}&status=eq.subscribed` +
      `&created_at=gt.${encodeURIComponent(flow.trigger_checked_at)}&created_at=lte.${encodeURIComponent(runStart)}` +
      `&select=id,email,created_at&order=created_at.asc&limit=${MAX_ENROL_PER_FLOW + 1}`);
    if (!r.ok) throw new Error(`Could not read new contacts (HTTP ${r.status}).`);
    const rows = r.data || [];
    const capped = rows.length > MAX_ENROL_PER_FLOW;
    const batch = capped ? rows.slice(0, MAX_ENROL_PER_FLOW) : rows;
    Object.assign(out, await enrolBatch(sb, flow, firstStep, batch, now, dryRun));
    // Advance the watermark only past what was actually handled.
    const next = capped ? batch[batch.length - 1].created_at : runStart;
    const w = await setChecked(next);
    if (!w.ok) throw new Error(`Enrolled people but could not advance the watermark (HTTP ${w.status}).`);
    out.capped = capped;
    return out;
  }

  /* ── segment_entry ────────────────────────────────────────────────── */
  if (!flow.segment_id) { out.skipped = 'no_segment'; return out; }
  const seg = await resolveSegment(sb, flow.user_id, flow.segment_id);
  if (!seg.ok) throw new Error(seg.error);

  if (baselining) {
    if (!dryRun) {
      const del = await sb('DELETE', `/email_flow_trigger_seen?flow_id=eq.${flow.id}`);
      if (!del.ok) throw new Error(`Could not reset the seen list (HTTP ${del.status}).`);
      await markSeen(sb, flow.id, [...new Set(seg.contacts.map(c => lc(c.email)).filter(Boolean))]);
    }
    const w = await setChecked(runStart);
    if (!w.ok) throw new Error(`Could not start watching (HTTP ${w.status}).`);
    out.baselined = true;
    out.alreadyInSegment = seg.contacts.length;
    return out;
  }

  const seenRes = await sb('GET', `/email_flow_trigger_seen?flow_id=eq.${flow.id}&select=email&limit=20000`);
  if (!seenRes.ok) throw new Error(`Could not read the seen list (HTTP ${seenRes.status}).`);
  const seen = new Set((seenRes.data || []).map(r => lc(r.email)));
  const fresh = seg.contacts.filter(c => c.email && !seen.has(lc(c.email)));
  const batch = fresh.slice(0, MAX_ENROL_PER_FLOW);
  Object.assign(out, await enrolBatch(sb, flow, firstStep, batch, now, dryRun));
  // Everyone handled this run is now "seen" — enrolled, suppressed or already
  // in the flow alike — so they are not reconsidered. The rest wait for next run.
  if (!dryRun) await markSeen(sb, flow.id, [...new Set(batch.map(c => lc(c.email)))]);
  out.capped = fresh.length > batch.length;
  return out;
}

module.exports = withFailureReporting('api/cron-flow-triggers', async function handler(req, res) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return res.status(500).json({ error: 'CRON_SECRET is not configured — refusing to run an unauthenticated job.' });
  if ((req.headers['authorization'] || '').replace(/^Bearer\s+/i, '') !== cronSecret) return res.status(401).json({ error: 'Unauthorized' });

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return res.status(500).json({ error: 'SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not configured.' });

  const dryRun = !!(req.query && (req.query.dryRun === '1' || req.query.dryRun === 'true'));
  const sb = (m, p, b) => sbRest(supabaseUrl, serviceKey, m, p, b);
  const now = new Date();

  const fr = await sb('GET', `/email_flows?status=eq.active&trigger_type=in.(${TRIGGERS.join(',')})&select=*&order=created_at.asc&limit=${MAX_FLOWS}`);
  if (!fr.ok) {
    if (fr.status === 404) return res.status(503).json({ code: 'not_installed', error: 'Automation tables do not exist. Run supabase-email-engine.sql.' });
    return res.status(500).json({ error: `Could not read flows (HTTP ${fr.status}).` });
  }
  const flows = fr.data || [];
  if (flows.length && !('trigger_checked_at' in flows[0])) {
    return res.status(503).json({ code: 'not_installed', error: 'Automatic enrolment is not installed. Run supabase-email-flow-triggers.sql in the Supabase SQL editor.' });
  }

  const report = { checkedAt: now.toISOString(), dryRun, flows: flows.length, enrolled: 0, failed: 0, details: [] };
  for (const flow of flows) {
    try {
      const d = await processFlow(sb, flow, now, dryRun);
      report.enrolled += d.enrolled || 0;
      report.details.push(d);
    } catch (e) {
      // One flow's problem must not stop the others. Its watermark/baseline
      // was not advanced, so the next run retries it.
      report.failed++;
      report.details.push({ flow: flow.name, trigger: flow.trigger_type, error: e.message });
      await reportFailure({
        source: 'api/cron-flow-triggers', kind: 'database_error', severity: 'warning',
        message: `Automatic enrolment for flow "${flow.name}" failed: ${e.message}`,
        detail: { flowId: flow.id, trigger: flow.trigger_type }, userId: flow.user_id,
      });
    }
  }
  return res.status(200).json({ ok: true, ...report });
});

module.exports.MAX_ENROL_PER_FLOW = MAX_ENROL_PER_FLOW;
module.exports.processFlow = processFlow;
