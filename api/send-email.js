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

const DAILY_SEND_LIMIT   = 50;
const RATE_LIMIT_WINDOW  = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX     = 10;

const rateBuckets   = new Map();
let dailySendCount  = 0;
let dailyWindowDate = new Date().toDateString();

function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) return fwd.split(',')[0].trim();
  return req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
}

function checkRateLimit(ip) {
  const now = Date.now();
  let b = rateBuckets.get(ip);
  if (!b || now - b.windowStart > RATE_LIMIT_WINDOW) {
    b = { windowStart: now, count: 0 };
    rateBuckets.set(ip, b);
  }
  b.count++;
  return b.count <= RATE_LIMIT_MAX;
}

function checkDailyLimit() {
  const today = new Date().toDateString();
  if (today !== dailyWindowDate) {
    dailySendCount  = 0;
    dailyWindowDate = today;
  }
  if (dailySendCount >= DAILY_SEND_LIMIT) return false;
  dailySendCount++;
  return true;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = getClientIp(req);
  if (!checkRateLimit(ip))
    return res.status(429).json({ error: 'Too many requests. Slow down.' });
  if (!checkDailyLimit())
    return res.status(429).json({ error: `Daily send limit of ${DAILY_SEND_LIMIT} reached. Resets at midnight.` });

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
        dailySent:  dailySendCount,
        dailyLimit: DAILY_SEND_LIMIT,
        ...(warnings.length ? { warnings } : {}),
      });
    }

    // Resend error format: { name, message, statusCode }
    const errMsg = data.message || data.name || `Resend error ${upstream.status}`;
    return res.status(upstream.status).json({ error: errMsg });

  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
};
