/**
 * api/_lib/failure-alert.js — email the administrators when something breaks.
 *
 * Not a Vercel route; api/_lib/ is excluded from routing.
 *
 * ── Why an email, and why only sometimes ───────────────────────────────────
 *
 * A failures console that nobody opens is the same as no console at all. The
 * whole value of recording failures is that somebody who can fix one finds out
 * on the day it starts, so an incident that is new — or still going an hour
 * after the last time we said so — is emailed.
 *
 * The judgement about WHEN is made in SQL, inside record_system_failure(),
 * because that is the only place the decision can be made without a race: a
 * broken upstream breaks for every request at once, and a check-then-send in
 * JavaScript would have a hundred concurrent callers all read "not yet
 * notified" and all send. The function returns alert_due, and only the caller
 * holding a true gets here.
 *
 * The same reasoning applies to marking it sent: mark_failure_notified() runs
 * AFTER the email is accepted, so a send that fails leaves the incident due
 * and the next occurrence tries again, rather than recording an alert nobody
 * received.
 *
 * ── Who gets told ──────────────────────────────────────────────────────────
 *
 * The account holders with role admin or super_admin, or the addresses in
 * FAILURE_ALERT_EMAILS when a deployment would rather route these somewhere
 * else — an on-call alias, a ticketing inbox. Never a customer.
 */

'use strict';

const { sbRest } = require('./supabase-rest.js');

const SEVERITY_LABEL = {
  critical: 'CRITICAL',
  error: 'Error',
  warning: 'Warning',
  info: 'Notice',
};

/** Escape for the HTML body of the alert email. */
function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Who to tell.
 *
 * FAILURE_ALERT_EMAILS wins when set, because a deployment that has routed
 * these somewhere deliberate should not also spray them at every admin
 * account. Otherwise it is the admins on the platform.
 */
async function recipients(supabaseUrl, serviceKey) {
  const configured = (process.env.FAILURE_ALERT_EMAILS || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  if (configured.length) return configured.slice(0, 10);

  const res = await sbRest(supabaseUrl, serviceKey, 'GET',
    '/profiles?role=in.(admin,super_admin)&select=email&limit=10');
  if (!res.ok || !Array.isArray(res.data)) return [];
  return res.data.map(r => r.email).filter(Boolean);
}

function buildEmail(incident, appUrl) {
  const label = SEVERITY_LABEL[incident.severity] || 'Error';
  const console_ = `${appUrl}/admin/failures.html`;
  const repeat = incident.occurrences > 1
    ? `<p style="margin:0 0 14px;color:#b45309;"><strong>${incident.occurrences} occurrences</strong>${
        incident.affected_users > 0 ? ` across ${incident.affected_users} account${incident.affected_users === 1 ? '' : 's'}` : ''
      }, first seen ${esc(new Date(incident.first_seen).toUTCString())}.</p>`
    : '';

  const remedy = incident.remedy
    ? `<div style="background:#f0f9ff;border-left:3px solid #0284c7;padding:12px 14px;margin:0 0 16px;">
         <div style="font-weight:600;color:#0c4a6e;margin-bottom:4px;">What to do</div>
         <div style="color:#0c4a6e;">${esc(incident.remedy)}</div>
       </div>`
    : '';

  const healing = incident.self_healing
    ? `<p style="margin:0 0 16px;color:#166534;background:#f0fdf4;border-left:3px solid #16a34a;padding:12px 14px;">
         <strong>Expected to clear on its own.</strong> ${esc(incident.recovery_action || '')}
       </p>`
    : '';

  const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:640px;margin:0 auto;padding:24px;color:#111827;">
  <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:${incident.severity === 'critical' ? '#b91c1c' : '#b45309'};font-weight:700;margin-bottom:6px;">${esc(label)}</div>
  <h1 style="font-size:19px;margin:0 0 4px;">${esc(incident.source)}</h1>
  <p style="margin:0 0 18px;color:#374151;font-size:15px;">${esc(incident.message)}</p>
  ${repeat}
  ${remedy}
  ${healing}
  <table style="width:100%;border-collapse:collapse;font-size:13px;margin:0 0 18px;">
    <tr><td style="padding:5px 0;color:#6b7280;width:120px;">Kind</td><td style="padding:5px 0;">${esc(incident.kind)}</td></tr>
    <tr><td style="padding:5px 0;color:#6b7280;">Last seen</td><td style="padding:5px 0;">${esc(new Date(incident.last_seen).toUTCString())}</td></tr>
    <tr><td style="padding:5px 0;color:#6b7280;">Incident</td><td style="padding:5px 0;font-family:ui-monospace,monospace;font-size:12px;">${esc(incident.fingerprint)}</td></tr>
  </table>
  <a href="${esc(console_)}" style="display:inline-block;background:#111827;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:600;font-size:14px;">Open the failures console</a>
  <p style="margin:22px 0 0;color:#9ca3af;font-size:12px;">
    You are receiving this because you administer this Audema deployment.
    Repeat alerts for the same incident are sent at most once an hour, and stop
    entirely once it is acknowledged or resolved.
  </p>
</div>`.trim();

  const text = [
    `${label}: ${incident.source}`,
    '',
    incident.message,
    '',
    incident.occurrences > 1 ? `${incident.occurrences} occurrences since ${new Date(incident.first_seen).toUTCString()}.` : '',
    incident.remedy ? `\nWhat to do: ${incident.remedy}` : '',
    incident.self_healing ? `\nExpected to clear on its own. ${incident.recovery_action || ''}` : '',
    `\nIncident: ${incident.fingerprint}`,
    `Console:  ${console_}`,
  ].filter(Boolean).join('\n');

  return {
    subject: `[${label}] ${incident.source} — ${String(incident.message).slice(0, 90)}`,
    html,
    text,
  };
}

/**
 * Send the alert for one incident, then mark it notified.
 *
 * Never throws: it is called from the same fire-and-forget path as the
 * reporter, and an alerter that throws inside a catch block is worse than no
 * alerter at all.
 *
 * @returns {Promise<{sent: boolean, reason?: string, to?: number}>}
 */
async function alertAdmins(failureId) {
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const resendKey   = process.env.RESEND_API_KEY;
    const fromEmail   = process.env.RESEND_FROM_EMAIL;
    if (!supabaseUrl || !serviceKey) return { sent: false, reason: 'no_supabase' };

    const inc = await sbRest(supabaseUrl, serviceKey, 'GET',
      `/system_failures?id=eq.${encodeURIComponent(failureId)}&limit=1`);
    const incident = inc.ok && Array.isArray(inc.data) ? inc.data[0] : null;
    if (!incident) return { sent: false, reason: 'incident_not_found' };

    if (!resendKey || !fromEmail) {
      // The incident is still recorded and still visible in the console. Say
      // on the log that nobody was emailed, rather than letting a silent
      // no-op look like a delivered alert.
      console.warn('[failure-alert] RESEND_API_KEY/RESEND_FROM_EMAIL not set — ' +
        `incident ${incident.fingerprint} recorded but no alert sent.`);
      return { sent: false, reason: 'no_mailer' };
    }

    const to = await recipients(supabaseUrl, serviceKey);
    if (!to.length) {
      console.warn('[failure-alert] no admin recipients — set FAILURE_ALERT_EMAILS ' +
        'or give an account the admin role.');
      return { sent: false, reason: 'no_recipients' };
    }

    const appUrl = (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://audema.com').replace(/\/$/, '');
    const mail = buildEmail(incident, appUrl);

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: `${process.env.RESEND_FROM_NAME || 'Audema'} <${fromEmail}>`,
        to,
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      // Deliberately NOT marking it notified: the incident stays due and the
      // next occurrence tries again. Recording an alert that was not delivered
      // is the one outcome worse than not alerting.
      console.error('[failure-alert] Resend refused the alert:', res.status);
      return { sent: false, reason: `resend_${res.status}` };
    }

    await sbRest(supabaseUrl, serviceKey, 'POST', '/rpc/mark_failure_notified',
      { p_failure_id: failureId });

    return { sent: true, to: to.length };
  } catch (err) {
    try { console.error('[failure-alert] alerter failed:', err && err.message); } catch { /* nothing left */ }
    return { sent: false, reason: 'threw' };
  }
}

module.exports = { alertAdmins, buildEmail };
