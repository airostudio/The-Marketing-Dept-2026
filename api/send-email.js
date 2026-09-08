/**
 * Send Email API — Vercel serverless function
 *
 * POST {
 *   to:          string,   // recipient email
 *   toName?:     string,
 *   subject:     string,
 *   html:        string,   // HTML body
 *   text?:       string,   // plain text fallback
 *   replyTo?:    string,   // reply-to address
 *   prospectId?: string,   // for activity logging
 *   sequenceId?: string,
 *   stepIndex?:  number,
 * }
 *
 * Sends via Resend (resend.com). Enforces a 50 emails/day budget to protect deliverability.
 * All credentials live exclusively in Vercel environment variables.
 *
 * Required env vars:
 *   RESEND_API_KEY      — Resend API key (re_...)
 *   RESEND_FROM_EMAIL   — verified sender address, e.g. hello@yourdomain.com
 *   RESEND_FROM_NAME    — (optional) sender display name, defaults to "Audema"
 */

'use strict';

const { ensureComplianceFooter } = require('./_lib/compliance-footer.js');
const { rateLimited } = require('./_lib/rate-limit.js');
const { authenticateSender, filterSuppressed, claimQuota, releaseQuota } =
  require('./_lib/send-guard.js');

const RATE_LIMIT_WINDOW  = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX     = 10;

let dailyWindowDate = new Date().toDateString();



module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Same open-relay problem as api/send-campaign.js: this accepted a
  // recipient, a subject and an HTML body from anyone who could reach the URL
  // and sent it through the account's Resend key from its verified domain.
  const auth = await authenticateSender(req);
  if (auth.error) {
    const message = {
      server_unconfigured: 'SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not configured.',
      no_token: 'Sign in to send email.',
      invalid_token: 'Your session has expired. Sign in again.',
      auth_unreachable: 'Could not verify your session. Nothing was sent.',
    }[auth.error] || 'Not authorised.';
    return res.status(auth.error === 'server_unconfigured' ? 500 : 401).json({ error: message });
  }
  const { userId, profile } = auth;

  // Keyed on the sender, and therefore placed after authentication.
  // Sending mail from the account's verified domain is the most
  // valuable thing here to abuse, and an address is the wrong unit to
  // meter it by: a shared office is charged as one sender, while one
  // account can spread a burst across as many addresses as it can
  // reach. The daily ceiling that actually protects deliverability is
  // claimQuota() below, which is database-backed; this only stops one
  // account hammering one instance.
  if (rateLimited(req, res, { name: 'send-email', max: RATE_LIMIT_MAX, windowMs: RATE_LIMIT_WINDOW, auth: { userId } })) return;

  const apiKey    = process.env.RESEND_API_KEY;
  const fromEmail = process.env.RESEND_FROM_EMAIL;
  const fromName  = process.env.RESEND_FROM_NAME || 'Audema';

  if (!apiKey)    return res.status(500).json({ error: 'RESEND_API_KEY not configured' });
  if (!fromEmail) return res.status(500).json({ error: 'RESEND_FROM_EMAIL not configured' });

  const {
    to, toName, subject, html, text, replyTo, prospectId, sequenceId, stepIndex,
    companyName, mailingAddress,
  } = req.body || {};

  if (!to || !subject || !html)
    return res.status(400).json({ error: 'to, subject, and html are required' });

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to))
    return res.status(400).json({ error: 'Invalid recipient email address' });

  // Opt-outs apply to one-off sends too. A prospect who unsubscribed from a
  // campaign must not then receive an individually-drafted follow-up.
  const supp = await filterSuppressed(userId, [{ to }]);
  if (!supp.ok) {
    return res.status(supp.code === 'not_installed' ? 503 : 500)
      .json({ error: supp.error, code: supp.code });
  }
  if (supp.suppressed.length) {
    return res.status(409).json({
      error: `${to} has opted out or is undeliverable (${supp.suppressed[0].reason}). Nothing was sent.`,
      code: 'suppressed',
    });
  }

  const quota = await claimQuota(userId, 1, profile);
  if (!quota.ok) {
    return res.status(quota.code === 'not_installed' ? 503 : 500)
      .json({ error: quota.error, code: quota.code });
  }
  if (quota.granted <= 0) {
    return res.status(429).json({
      error: `Daily send limit of ${quota.cap} reached for this account. Resets at midnight UTC.`,
    });
  }

  // Every email this endpoint sends gets a compliance footer (unsubscribe/
  // opt-out language + physical mailing address) unless the body already has
  // one, and a Reply-To — this is a hard requirement for the account, not
  // left to whatever copy was drafted. See _lib/compliance-footer.js for the
  // company/address/reply-to resolution order.
  const footer = ensureComplianceFooter({ html, text, companyName, mailingAddress, replyTo });
  const resolvedReplyTo = replyTo || process.env.COMPLIANCE_REPLY_TO || fromEmail;

  // Resend tags for filtering / webhooks
  // Tag values must be [a-zA-Z0-9_-] — sanitize anything that isn't
  function sanitizeTagValue(val) {
    return String(val).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 256) || 'unknown';
  }

  const tags = [
    ...(prospectId  ? [{ name: 'prospect_id',  value: sanitizeTagValue(prospectId)  }] : []),
    ...(sequenceId  ? [{ name: 'sequence_id',  value: sanitizeTagValue(sequenceId)  }] : []),
    ...(stepIndex !== undefined ? [{ name: 'step_index', value: sanitizeTagValue(stepIndex) }] : []),
  ];

  // Resend payload — https://resend.com/docs/api-reference/emails/send-email
  const payload = {
    from:     `${fromName} <${fromEmail}>`,
    to:       toName ? [`${toName} <${to}>`] : [to],
    subject,
    html:     footer.html,
    ...(footer.text    ? { text: footer.text }   : {}),
    reply_to: resolvedReplyTo,
    ...(tags.length ? { tags }                   : {}),
  };

  try {
    const upstream = await fetch('https://api.resend.com/emails', {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type':  'application/json',
      },
      body:   JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });

    const data = await upstream.json().catch(() => ({}));

    if (upstream.ok) {
      const warnings = [];
      if (footer.appended && !footer.hasMailingAddress) {
        warnings.push('No physical mailing address configured — set one in Business Brain > Sender Identity, or COMPLIANCE_MAILING_ADDRESS, to stay compliant with CAN-SPAM/GDPR/CASL.');
      }
      return res.json({
        success:    true,
        id:         data.id,      // Resend email ID for tracking
        to,
        subject,
        dailyLimit: quota.cap,
        ...(warnings.length ? { warnings } : {}),
      });
    }

    // Resend error format: { name, message, statusCode }
    // The quota was claimed before the call, so a failure hands it back —
    // otherwise a provider outage silently eats the day's allowance.
    await releaseQuota(userId, 1);
    const errMsg = data.message || data.name || `Resend error ${upstream.status}`;
    return res.status(upstream.status).json({ error: errMsg });

  } catch (err) {
    await releaseQuota(userId, 1);
    return res.status(502).json({ error: err.message });
  }
};
