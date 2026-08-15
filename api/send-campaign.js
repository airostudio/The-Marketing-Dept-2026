/**
 * Send Campaign API — Vercel serverless function
 *
 * POST {
 *   subject:     string,            // campaign subject (supports {{firstName}} etc merge tags)
 *   html:        string,            // HTML body template
 *   text?:       string,            // plain text fallback template
 *   replyTo?:    string,
 *   campaignId?: string,            // for tagging/tracking
 *   recipients:  Array<{
 *     to:        string,            // required, valid email
 *     toName?:   string,
 *     mergeFields?: Object,         // e.g. { firstName: 'Sam', company: 'Acme' }
 *   }>,
 * }
 *
 * Sends a drafted campaign to a batch of recipients via Resend, one call per recipient
 * (keeps per-recipient personalization and per-recipient error reporting simple and
 * matches how api/send-email.js already talks to Resend). This endpoint is the
 * "mailman" — it does not draft copy and does not decide whether a campaign is safe
 * to send; that decision is made by Scotty QA review on the client before this is
 * ever called.
 *
 * Enforces the same 50 emails/day budget as api/send-email.js (shared in-memory
 * counter — both endpoints protect the same sending domain's deliverability) plus a
 * per-request batch cap so one call can't blow through the whole daily budget.
 *
 * Required env vars:
 *   RESEND_API_KEY      — Resend API key (re_...)
 *   RESEND_FROM_EMAIL   — verified sender address, e.g. hello@yourdomain.com
 *   RESEND_FROM_NAME    — (optional) sender display name, defaults to "Audema"
 */

'use strict';

const { sign, isConfigured: unsubscribeConfigured } = require('./_lib/unsubscribe-token.js');

const DAILY_SEND_LIMIT   = 50;
const MAX_BATCH_SIZE     = 25;
const RATE_LIMIT_WINDOW  = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX     = 3;         // campaign sends are heavier than single sends

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

function resetDailyWindowIfNeeded() {
  const today = new Date().toDateString();
  if (today !== dailyWindowDate) {
    dailySendCount  = 0;
    dailyWindowDate = today;
  }
}

function sanitizeTagValue(val) {
  return String(val).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 256) || 'unknown';
}

// Replace {{token}} merge tags with per-recipient values. Unresolved tokens are
// left as-is rather than silently dropped, so a bad recipient row is visible in
// the sent output instead of vanishing.
function applyMergeFields(template, mergeFields) {
  if (!template) return template;
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, key) => {
    const val = mergeFields && mergeFields[key];
    return (val === undefined || val === null || val === '') ? match : String(val);
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = getClientIp(req);
  if (!checkRateLimit(ip))
    return res.status(429).json({ error: 'Too many campaign sends. Slow down.' });

  const proto   = req.headers['x-forwarded-proto'] || 'https';
  const baseUrl = process.env.PUBLIC_APP_URL || `${proto}://${req.headers.host}`;

  const apiKey    = process.env.RESEND_API_KEY;
  const fromEmail = process.env.RESEND_FROM_EMAIL;
  const fromName  = process.env.RESEND_FROM_NAME || 'Audema';

  if (!apiKey)    return res.status(500).json({ error: 'RESEND_API_KEY not configured' });
  if (!fromEmail) return res.status(500).json({ error: 'RESEND_FROM_EMAIL not configured' });

  const { subject, html, text, replyTo, campaignId, recipients } = req.body || {};

  if (!subject || !html)
    return res.status(400).json({ error: 'subject and html are required' });

  if (!Array.isArray(recipients) || recipients.length === 0)
    return res.status(400).json({ error: 'recipients must be a non-empty array' });

  if (recipients.length > MAX_BATCH_SIZE)
    return res.status(400).json({ error: `A single campaign send is capped at ${MAX_BATCH_SIZE} recipients. Split into smaller batches.` });

  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const validRecipients = [];
  const rejected = [];

  recipients.forEach((r, i) => {
    const to = (r && r.to || '').trim();
    if (!to || !emailRe.test(to)) {
      rejected.push({ index: i, to: r && r.to, error: 'Invalid or missing email address' });
    } else {
      validRecipients.push(r);
    }
  });

  resetDailyWindowIfNeeded();
  const remainingBudget = DAILY_SEND_LIMIT - dailySendCount;
  if (remainingBudget <= 0)
    return res.status(429).json({ error: `Daily send limit of ${DAILY_SEND_LIMIT} reached. Resets at midnight.` });

  const toSend = validRecipients.slice(0, remainingBudget);
  const skippedBudget = validRecipients.slice(remainingBudget).map(r => ({ to: r.to, error: 'Daily send limit reached' }));

  const results = [];

  for (const recipient of toSend) {
    const { to, toName, mergeFields, _contactId } = recipient;

    const personalizedSubject = applyMergeFields(subject, mergeFields);
    const personalizedHtml    = applyMergeFields(html, mergeFields);
    const personalizedText    = text ? applyMergeFields(text, mergeFields) : undefined;

    const tags = [
      ...(campaignId  ? [{ name: 'campaign_id', value: sanitizeTagValue(campaignId) }] : []),
      ...(_contactId  ? [{ name: 'contact_id',  value: sanitizeTagValue(_contactId) }] : []),
    ];

    // RFC 8058 List-Unsubscribe / List-Unsubscribe-Post — Gmail, Yahoo, and
    // Apple all require these on bulk senders since May 2026 and will
    // otherwise reject or spam-box the send. The link points at
    // api/unsubscribe.js, signed so it can't be forged or reused for a
    // different recipient.
    const unsubToken = unsubscribeConfigured() ? sign(_contactId || null, to) : null;
    const unsubUrl = unsubToken
      ? `${baseUrl}/api/unsubscribe?c=${encodeURIComponent(_contactId || '-')}&e=${encodeURIComponent(Buffer.from(to).toString('base64url'))}&t=${unsubToken}`
      : null;

    const payload = {
      from:    `${fromName} <${fromEmail}>`,
      to:      toName ? [`${toName} <${to}>`] : [to],
      subject: personalizedSubject,
      html:    personalizedHtml,
      ...(personalizedText ? { text: personalizedText } : {}),
      ...(replyTo ? { reply_to: replyTo } : {}),
      ...(tags.length ? { tags } : {}),
      ...(unsubUrl ? {
        headers: {
          'List-Unsubscribe':      `<${unsubUrl}>, <mailto:${fromEmail}?subject=unsubscribe>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      } : {}),
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
        dailySendCount++;
        results.push({ to, success: true, id: data.id });
      } else {
        const errMsg = data.message || data.name || `Resend error ${upstream.status}`;
        results.push({ to, success: false, error: errMsg });
      }
    } catch (err) {
      results.push({ to, success: false, error: err.message });
    }
  }

  const sentCount = results.filter(r => r.success).length;

  return res.json({
    success:    true,
    campaignId: campaignId || null,
    sent:       sentCount,
    failed:     results.length - sentCount,
    rejected:   [...rejected, ...skippedBudget],
    results,
    dailySent:  dailySendCount,
    dailyLimit: DAILY_SEND_LIMIT,
    ...(unsubscribeConfigured() ? {} : {
      warnings: ['UNSUBSCRIBE_SECRET / SUPABASE_SERVICE_ROLE_KEY not configured — sends went out without List-Unsubscribe headers, which Gmail/Yahoo/Apple require for bulk senders.'],
    }),
  });
};
