/**
 * api/_lib/autopilot/activity.js — the "What happened" inbox: everything an
 * agent did on its own, every problem it fixed, and anything it needs from
 * the business (an approval, a login), with an email for the things that
 * need a person.
 *
 * Emails go only for needs_approval, needs_permission and failed, and the
 * same message is not emailed twice within six hours.
 */

'use strict';

const EMAIL_KINDS = new Set(['needs_approval', 'needs_permission', 'failed']);
const DEDUPE_MS = 6 * 60 * 60 * 1000;
const str = (v, n) => String(v == null ? '' : v).slice(0, n);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * @param {Function} sb
 * @param {{user_id, intel_profile_id?, project_id?, agent?, job_id?, kind, title, body?, details?, action?}} ev
 * @returns {Promise<object|null>} the stored event
 */
async function record(sb, ev, deps = {}) {
  const row = {
    user_id: ev.user_id, intel_profile_id: ev.intel_profile_id || null, project_id: ev.project_id || null,
    agent: ev.agent || null, job_id: ev.job_id || null, kind: ev.kind,
    title: str(ev.title, 200), body: str(ev.body, 4000), details: ev.details || {}, action: ev.action || null,
  };
  const ins = await sb('POST', '/activity_events', row);
  const stored = ins.ok && ins.data && ins.data[0];
  if (stored && EMAIL_KINDS.has(ev.kind)) {
    try { await maybeEmail(sb, stored, deps); } catch { /* the inbox has it even if the email fails */ }
  }
  return stored || null;
}

async function maybeEmail(sb, ev, deps) {
  const apiKey = process.env.RESEND_API_KEY, from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from) return;
  const since = new Date(Date.now() - DEDUPE_MS).toISOString();
  const dup = await sb('GET', `/activity_events?user_id=eq.${ev.user_id}&title=eq.${encodeURIComponent(ev.title)}&emailed_at=gte.${encodeURIComponent(since)}&select=id&limit=1`);
  if (dup.ok && (dup.data || []).length) return;
  const p = await sb('GET', `/profiles?id=eq.${ev.user_id}&select=email&limit=1`);
  const to = p.ok && p.data && p.data[0] && p.data[0].email;
  if (!to) return;
  const base = (process.env.APP_BASE_URL || '').replace(/\/+$/, '');
  const link = base ? `${base}/inbox.html` : null;
  const html = `<p>${esc(ev.title)}</p>${ev.body ? `<p style="white-space:pre-wrap">${esc(ev.body)}</p>` : ''}${link ? `<p><a href="${esc(link)}">Open What happened in Audema</a></p>` : ''}`;
  const r = await (deps.fetch || fetch)('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: `${process.env.RESEND_FROM_NAME || 'Audema'} <${from}>`, to: [to], subject: `Audema: ${ev.title}`.slice(0, 150), html }),
    signal: AbortSignal.timeout(10000),
  });
  if (r.ok) await sb('PATCH', `/activity_events?id=eq.${ev.id}`, { emailed_at: new Date().toISOString() });
}

module.exports = { record, EMAIL_KINDS };
