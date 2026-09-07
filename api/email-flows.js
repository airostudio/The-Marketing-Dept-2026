/**
 * api/email-flows.js — automation flows: define them, enrol people, watch them run.
 *
 * POST { action: 'create',   name, steps: [{delayHours, subject, html}], triggerType?, segmentId?, fromName?, fromEmail? }
 * POST { action: 'list' }
 * POST { action: 'get',      flowId }
 * POST { action: 'setStatus', flowId, status }   // draft | active | paused
 * POST { action: 'enrol',    flowId, recipients: [{email, contactId?}] }
 * POST { action: 'exit',     flowId, email }
 * Header: Authorization: Bearer <the caller's own Supabase access token>
 *
 * ── The rules a flow has to respect ──────────────────────────────────────
 *
 *  - A paused or draft flow enrols nobody and sends nothing. A flow that kept
 *    sending after someone paused it is worse than no automation at all.
 *  - One live enrolment per person per flow, enforced by a partial unique
 *    index. Re-enrolling someone mid-sequence would run two overlapping
 *    copies of the same series at them.
 *  - Unsubscribed, bounced and complained contacts are never enrolled, and are
 *    dropped mid-flow by the cron. A sequence that keeps mailing someone who
 *    opted out is the failure that gets a sending domain blocked.
 *
 * Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

'use strict';

const { sbRest } = require('./_lib/supabase-rest.js');

const TRIGGERS = ['manual', 'contact_created', 'segment_entry'];
const STATUSES = ['draft', 'active', 'paused'];
const MAX_STEPS = 20;

// A contact in any of these states must not receive automated mail.
const SUPPRESSED = ['unsubscribed', 'bounced', 'complained'];

async function getCallerFromToken(supabaseUrl, serviceKey, accessToken) {
  const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return null;
  return res.json();
}

function tableError(res) {
  if (res.status === 404) {
    return { code: 'not_installed',
             error: 'Automation flows are not installed. Run supabase-email-engine.sql in the Supabase SQL editor.' };
  }
  return { code: 'db_error', error: `Database error (HTTP ${res.status}).` };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: 'SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not configured.' });
  }

  const accessToken = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
  if (!accessToken) return res.status(401).json({ error: 'Missing Authorization header.' });
  const caller = await getCallerFromToken(supabaseUrl, serviceKey, accessToken);
  if (!caller?.id) return res.status(401).json({ error: 'Invalid or expired session.' });

  const sb = (m, p, b) => sbRest(supabaseUrl, serviceKey, m, p, b);
  const body = req.body || {};

  async function ownedFlow(flowId) {
    if (!flowId) return { http: 400, err: { error: 'flowId is required.' } };
    const r = await sb('GET', `/email_flows?id=eq.${encodeURIComponent(flowId)}&limit=1`);
    if (!r.ok) return { http: r.status === 404 ? 503 : 500, err: tableError(r) };
    const f = r.data && r.data[0];
    if (!f || f.user_id !== caller.id) return { http: 404, err: { error: 'Flow not found.' } };
    return { flow: f };
  }

  try {
    /* ── create ────────────────────────────────────────────────────────── */
    if (body.action === 'create') {
      const name = String(body.name || '').trim();
      if (!name) return res.status(400).json({ error: 'A flow name is required.' });

      const steps = Array.isArray(body.steps) ? body.steps : [];
      if (!steps.length) return res.status(400).json({ error: 'A flow needs at least one step.' });
      if (steps.length > MAX_STEPS) {
        return res.status(400).json({ error: `A flow can have at most ${MAX_STEPS} steps.` });
      }
      for (const [i, s] of steps.entries()) {
        if (!String(s.subject || '').trim()) {
          return res.status(400).json({ error: `Step ${i + 1} has no subject.` });
        }
        if (!String(s.html || '').trim()) {
          return res.status(400).json({ error: `Step ${i + 1} has no content.` });
        }
        if (Number(s.delayHours) < 0) {
          return res.status(400).json({ error: `Step ${i + 1} has a negative delay.` });
        }
      }

      const triggerType = TRIGGERS.includes(body.triggerType) ? body.triggerType : 'manual';
      if (triggerType === 'segment_entry' && !body.segmentId) {
        return res.status(400).json({ error: 'A segment-entry flow needs a segmentId.' });
      }

      const created = await sb('POST', '/email_flows', {
        user_id: caller.id, name, trigger_type: triggerType,
        segment_id: body.segmentId || null,
        from_name: body.fromName || null, from_email: body.fromEmail || null,
        // Created as a draft on purpose: a flow should not start mailing the
        // moment it is saved, before anyone has read it back.
        status: 'draft',
      });
      if (!created.ok) return res.status(created.status === 404 ? 503 : 500).json(tableError(created));
      const flow = created.data && created.data[0];
      if (!flow) return res.status(500).json({ error: 'The flow was not created.' });

      const rows = steps.map((s, i) => ({
        flow_id: flow.id, step_order: i + 1,
        delay_hours: Math.max(0, Math.floor(Number(s.delayHours) || 0)),
        subject: String(s.subject).trim(), html: String(s.html),
      }));
      const ins = await sb('POST', '/email_flow_steps', rows);
      if (!ins.ok) {
        await sb('DELETE', `/email_flows?id=eq.${flow.id}`);
        return res.status(500).json({ error: 'The flow steps could not be saved.' });
      }

      return res.json({ ok: true, flow: { id: flow.id, name, status: 'draft', steps: rows.length } });
    }

    /* ── list ──────────────────────────────────────────────────────────── */
    if (body.action === 'list') {
      const r = await sb('GET', `/email_flows?user_id=eq.${caller.id}&order=created_at.desc&limit=200`);
      if (!r.ok) return res.status(r.status === 404 ? 503 : 500).json(tableError(r));
      const flows = r.data || [];

      // Live counts per flow, so the list says what is actually happening
      // rather than just what was configured.
      const out = [];
      for (const f of flows) {
        const e = await sb('GET',
          `/email_flow_enrolments?flow_id=eq.${f.id}&select=status`);
        const rows = (e.ok && e.data) || [];
        out.push({
          id: f.id, name: f.name, status: f.status, triggerType: f.trigger_type,
          createdAt: f.created_at,
          enrolled: rows.length,
          active: rows.filter(x => x.status === 'active').length,
          completed: rows.filter(x => x.status === 'completed').length,
          exited: rows.filter(x => x.status === 'exited').length,
        });
      }
      return res.json({ ok: true, flows: out });
    }

    /* ── get ───────────────────────────────────────────────────────────── */
    if (body.action === 'get') {
      const { flow, http, err } = await ownedFlow(body.flowId);
      if (err) return res.status(http).json(err);
      const s = await sb('GET', `/email_flow_steps?flow_id=eq.${flow.id}&order=step_order.asc`);
      return res.json({ ok: true,
        flow: { id: flow.id, name: flow.name, status: flow.status, triggerType: flow.trigger_type,
                segmentId: flow.segment_id, fromName: flow.from_name, fromEmail: flow.from_email },
        steps: ((s.ok && s.data) || []).map(x => ({
          order: x.step_order, delayHours: x.delay_hours, subject: x.subject, html: x.html })),
      });
    }

    /* ── setStatus ─────────────────────────────────────────────────────── */
    if (body.action === 'setStatus') {
      const { flow, http, err } = await ownedFlow(body.flowId);
      if (err) return res.status(http).json(err);
      if (!STATUSES.includes(body.status)) {
        return res.status(400).json({ error: `Status must be one of: ${STATUSES.join(', ')}.` });
      }
      const up = await sb('PATCH', `/email_flows?id=eq.${flow.id}`, { status: body.status });
      if (!up.ok) return res.status(500).json({ error: 'Could not update the flow.' });

      // Pausing stops the cron because it only selects enrolments whose flow
      // is active — the enrolments themselves are left alone so resuming
      // picks up where it left off rather than restarting everyone.
      return res.json({ ok: true, status: body.status });
    }

    /* ── enrol ─────────────────────────────────────────────────────────── */
    if (body.action === 'enrol') {
      const { flow, http, err } = await ownedFlow(body.flowId);
      if (err) return res.status(http).json(err);

      if (flow.status !== 'active') {
        return res.status(409).json({
          error: `This flow is ${flow.status}. Activate it before enrolling anyone — ` +
                 'a draft or paused flow would take people in and never mail them.',
        });
      }

      const recipients = Array.isArray(body.recipients) ? body.recipients : [];
      if (!recipients.length) return res.status(400).json({ error: 'recipients is required.' });

      const first = await sb('GET', `/email_flow_steps?flow_id=eq.${flow.id}&order=step_order.asc&limit=1`);
      const firstStep = (first.ok && first.data && first.data[0]) || null;
      if (!firstStep) return res.status(409).json({ error: 'This flow has no steps.' });

      // Never enrol someone who has opted out. Checking here as well as in the
      // cron means a suppressed contact does not even get a row.
      const emails = recipients.map(r => String(r.email || '').trim().toLowerCase()).filter(Boolean);
      const sup = await sb('GET',
        `/contacts?email=in.(${emails.map(encodeURIComponent).join(',')})&select=email,status`);
      const suppressed = new Set(((sup.ok && sup.data) || [])
        .filter(c => SUPPRESSED.includes(c.status))
        .map(c => String(c.email).toLowerCase()));

      const now = Date.now();
      const rows = recipients
        .filter(r => r.email && !suppressed.has(String(r.email).toLowerCase()))
        .map(r => ({
          flow_id: flow.id, user_id: caller.id,
          contact_id: r.contactId || null, email: String(r.email).trim(),
          next_step_order: firstStep.step_order,
          next_run_at: new Date(now + firstStep.delay_hours * 3600000).toISOString(),
          status: 'active',
        }));

      let enrolled = 0, alreadyIn = 0;
      for (const row of rows) {
        const ins = await sb('POST', '/email_flow_enrolments', row);
        if (ins.ok) enrolled++;
        else if (ins.status === 409) alreadyIn++;   // partial unique index did its job
      }

      return res.json({
        ok: true, enrolled, alreadyInFlow: alreadyIn,
        skippedSuppressed: suppressed.size,
        note: suppressed.size
          ? `${suppressed.size} recipient(s) were skipped because they have unsubscribed, bounced or complained.`
          : undefined,
      });
    }

    /* ── exit ──────────────────────────────────────────────────────────── */
    if (body.action === 'exit') {
      const { flow, http, err } = await ownedFlow(body.flowId);
      if (err) return res.status(http).json(err);
      if (!body.email) return res.status(400).json({ error: 'email is required.' });

      const up = await sb('PATCH',
        `/email_flow_enrolments?flow_id=eq.${flow.id}&email=eq.${encodeURIComponent(body.email)}&status=eq.active`,
        { status: 'exited', exit_reason: 'removed_manually', completed_at: new Date().toISOString() });
      if (!up.ok) return res.status(500).json({ error: 'Could not remove them from the flow.' });
      return res.json({ ok: true });
    }

    return res.status(400).json({ error: 'Unknown action.' });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Unexpected error.' });
  }
};

module.exports.SUPPRESSED = SUPPRESSED;
