/**
 * api/cron-email-flows.js — sends the automation steps that are due.
 *
 * GET /api/cron-email-flows            run it
 * GET /api/cron-email-flows?dryRun=1   report what would be sent, send nothing
 *
 * Bearer-gated by CRON_SECRET, the same gate as the other cron jobs.
 *
 * ── What this has to get right ───────────────────────────────────────────
 *
 * An automation that misfires is worse than one that does not exist: it mails
 * people who opted out, or mails the same person the same step twice, and
 * both cost a sending domain its reputation. So:
 *
 *  - An enrolment is claimed before it is sent, not after. The row is moved
 *    forward first; if the send then fails the step is not retried blindly,
 *    because a retry that re-sends a message that did go out is the worse of
 *    the two failures. Failures are recorded and reported.
 *  - Suppression is re-checked at send time, not only at enrolment. Somebody
 *    who unsubscribed on day one must not receive day three's email, and the
 *    enrolment was created before they opted out.
 *  - Only flows that are 'active' are processed, so pausing a flow genuinely
 *    stops it.
 *  - MAX_SENDS_PER_RUN caps the blast radius of a misconfigured flow. A bug
 *    that enrols an entire list should cost one capped run, not the domain.
 *
 * Required env vars:
 *   CRON_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY
 * Optional: RESEND_FROM_EMAIL, RESEND_FROM_NAME, PUBLIC_APP_URL,
 *           COMPLIANCE_COMPANY_NAME, COMPLIANCE_MAILING_ADDRESS
 */

'use strict';

const { sbRest } = require('./_lib/supabase-rest.js');
const { withFailureReporting } = require('./_lib/report-failure.js');
const { sign, isConfigured: unsubscribeConfigured } = require('./_lib/unsubscribe-token.js');
const { ensureComplianceFooter } = require('./_lib/compliance-footer.js');

const MAX_SENDS_PER_RUN = 200;
const SUPPRESSED = ['unsubscribed', 'bounced', 'complained'];

function personalise(text, contact) {
  if (!text) return text;
  return String(text).replace(/\{\{\s*([\w.]+)\s*\}\}/g, (whole, token) => {
    const map = {
      firstName: contact.firstname || contact.first_name || '',
      lastName: contact.lastname || contact.last_name || '',
      email: contact.email || '',
      company: contact.company || '',
    };
    const v = map[token];
    // An unresolved token is left as-is rather than blanked: "Hi ," reads as a
    // broken mail merge to the recipient either way, but leaving the token
    // visible makes it obvious to the operator which field was missing.
    return v ? v : whole;
  });
}

module.exports = withFailureReporting('api/cron-email-flows', async function handler(req, res) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return res.status(500).json({ error: 'CRON_SECRET is not configured — refusing to run an unauthenticated send.' });
  }
  const auth = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
  if (auth !== cronSecret) return res.status(401).json({ error: 'Unauthorized' });

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const apiKey      = process.env.RESEND_API_KEY;
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: 'SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not configured.' });
  }

  const dryRun = req.query && (req.query.dryRun === '1' || req.query.dryRun === 'true');
  if (!apiKey && !dryRun) {
    return res.status(500).json({ error: 'RESEND_API_KEY not configured.' });
  }

  const sb = (m, p, b) => sbRest(supabaseUrl, serviceKey, m, p, b);
  const now = new Date();

  // Everything due, on a flow that is actually active. The embedded select
  // pulls the flow in one round trip so a paused flow never even reaches the
  // send loop.
  const dueRes = await sb('GET',
    `/email_flow_enrolments?status=eq.active&next_run_at=lte.${now.toISOString()}` +
    `&select=*,email_flows!inner(id,name,status,from_name,from_email)` +
    `&email_flows.status=eq.active&order=next_run_at.asc&limit=${MAX_SENDS_PER_RUN}`);

  if (!dueRes.ok) {
    if (dueRes.status === 404) {
      return res.status(503).json({
        code: 'not_installed',
        error: 'Automation tables do not exist. Run supabase-email-engine.sql.',
      });
    }
    return res.status(500).json({ error: `Could not read due enrolments (HTTP ${dueRes.status}).` });
  }

  const due = dueRes.data || [];
  const report = { checkedAt: now.toISOString(), due: due.length, sent: 0, skipped: 0, failed: 0, completed: 0, details: [] };

  if (!due.length) {
    return res.status(200).json(Object.assign({ ok: true, dryRun: !!dryRun }, report));
  }

  for (const enrolment of due) {
    const flow = enrolment.email_flows || {};
    const email = enrolment.email;

    // Suppression re-checked here, not just at enrolment: this enrolment may
    // have been created days before the recipient opted out.
    const cRes = await sb('GET',
      `/contacts?email=eq.${encodeURIComponent(email)}&select=id,email,status,firstname,lastname,company&limit=1`);
    const contact = (cRes.ok && cRes.data && cRes.data[0]) || { email };
    if (SUPPRESSED.includes(contact.status)) {
      report.skipped++;
      report.details.push({ email, step: enrolment.next_step_order, outcome: 'suppressed', status: contact.status });
      if (!dryRun) {
        await sb('PATCH', `/email_flow_enrolments?id=eq.${enrolment.id}`, {
          status: 'exited', exit_reason: `contact_${contact.status}`, completed_at: now.toISOString(),
        });
      }
      continue;
    }

    const stepRes = await sb('GET',
      `/email_flow_steps?flow_id=eq.${enrolment.flow_id}&step_order=eq.${enrolment.next_step_order}&limit=1`);
    const step = (stepRes.ok && stepRes.data && stepRes.data[0]) || null;
    if (!step) {
      // No step at this order — the flow was edited underneath a running
      // enrolment. Completing is the safe reading: the sequence as it now
      // exists has nothing more to say to this person.
      report.completed++;
      report.details.push({ email, step: enrolment.next_step_order, outcome: 'no_such_step' });
      if (!dryRun) {
        await sb('PATCH', `/email_flow_enrolments?id=eq.${enrolment.id}`, {
          status: 'completed', completed_at: now.toISOString(),
        });
      }
      continue;
    }

    // Find what comes next before sending, so the enrolment can be advanced
    // in one write.
    const nextRes = await sb('GET',
      `/email_flow_steps?flow_id=eq.${enrolment.flow_id}&step_order=gt.${step.step_order}` +
      `&order=step_order.asc&limit=1`);
    const nextStep = (nextRes.ok && nextRes.data && nextRes.data[0]) || null;

    if (dryRun) {
      report.sent++;
      report.details.push({ email, flow: flow.name, step: step.step_order,
                            subject: step.subject, wouldSend: true,
                            nextStepAfter: nextStep ? nextStep.step_order : null });
      continue;
    }

    // Claim the enrolment BEFORE sending. If this process dies between the
    // claim and the send, the step is missed — which is recoverable and
    // visible. Claiming afterwards would instead risk sending the same step
    // twice on a retry, which is not recoverable: the mail has gone.
    const advance = nextStep
      ? { next_step_order: nextStep.step_order,
          next_run_at: new Date(now.getTime() + nextStep.delay_hours * 3600000).toISOString() }
      : { status: 'completed', completed_at: now.toISOString() };

    const claim = await sb('PATCH',
      `/email_flow_enrolments?id=eq.${enrolment.id}&status=eq.active` +
      `&next_step_order=eq.${enrolment.next_step_order}`, advance);
    // The status/step conditions make this a compare-and-set: if another run
    // of this cron claimed the same row first, it updates zero rows and this
    // one moves on instead of sending a duplicate.
    if (!claim.ok || !Array.isArray(claim.data) || claim.data.length === 0) {
      report.skipped++;
      report.details.push({ email, step: step.step_order, outcome: 'already_claimed' });
      continue;
    }

    const fromEmail = flow.from_email || process.env.RESEND_FROM_EMAIL;
    const fromName  = flow.from_name  || process.env.RESEND_FROM_NAME || 'Audema';
    if (!fromEmail) {
      report.failed++;
      report.details.push({ email, step: step.step_order, outcome: 'no_from_address' });
      continue;
    }

    // Same compliance guarantees as every other send path in this app.
    const proto = req.headers['x-forwarded-proto'] || 'https';
    const baseUrl = process.env.PUBLIC_APP_URL || `${proto}://${req.headers.host}`;
    let unsubUrl;
    if (unsubscribeConfigured() && contact.id) {
      unsubUrl = `${baseUrl}/api/unsubscribe?token=${encodeURIComponent(sign(contact.id, contact.email))}`;
    }

    const footer = ensureComplianceFooter({
      html: personalise(step.html, contact),
      text: undefined,
      companyName: process.env.COMPLIANCE_COMPANY_NAME,
      mailingAddress: process.env.COMPLIANCE_MAILING_ADDRESS,
      replyTo: process.env.COMPLIANCE_REPLY_TO || fromEmail,
      unsubscribeUrl: unsubUrl || undefined,
    });

    try {
      const upstream = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: `${fromName} <${fromEmail}>`,
          to: [email],
          subject: personalise(step.subject, contact),
          html: footer.html,
          reply_to: process.env.COMPLIANCE_REPLY_TO || fromEmail,
          // Tagged like every other send so the webhook can attribute the
          // engagement events back to this flow and step.
          tags: [
            { name: 'campaign_id', value: `flow_${enrolment.flow_id}`.slice(0, 60) },
            { name: 'flow_step', value: String(step.step_order) },
            ...(contact.id ? [{ name: 'contact_id', value: String(contact.id) }] : []),
          ],
          ...(unsubUrl ? { headers: {
            'List-Unsubscribe': `<${unsubUrl}>, <mailto:${fromEmail}?subject=unsubscribe>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          } } : {}),
        }),
        signal: AbortSignal.timeout(15000),
      });

      if (upstream.ok) {
        report.sent++;
        if (advance.status === 'completed') report.completed++;
        report.details.push({ email, flow: flow.name, step: step.step_order, outcome: 'sent' });
      } else {
        const errBody = await upstream.text().catch(() => '');
        report.failed++;
        report.details.push({ email, step: step.step_order, outcome: 'send_failed',
                              status: upstream.status, error: errBody.slice(0, 200) });
        // The enrolment stays advanced. Rewinding it would re-send on the next
        // run, and a 4xx from Resend usually means the message was rejected
        // for a reason that will not change in ten minutes.
      }
    } catch (e) {
      report.failed++;
      report.details.push({ email, step: step.step_order, outcome: 'send_error', error: e.message });
    }
  }

  return res.status(200).json(Object.assign({ ok: true, dryRun: !!dryRun,
    capped: due.length === MAX_SENDS_PER_RUN }, report));
});

module.exports.MAX_SENDS_PER_RUN = MAX_SENDS_PER_RUN;
