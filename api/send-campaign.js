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
 * Authenticated: the caller's own Supabase access token identifies the sending
 * account. Without that this was an open relay — any caller could send any
 * content to any address through the account's Resend key, from its verified
 * domain, with Allow-Origin: * so a page anywhere could do it from a browser.
 *
 * Every recipient is checked against the account's suppression list here, in
 * the only code path that reaches Resend. The previous gate was client-side
 * and depended on how a segment happened to be configured.
 *
 * The daily budget is per account and persisted (email_send_quota), claimed
 * before sending so concurrent sends cannot both spend the last of it. It used
 * to be one in-memory counter shared by every customer on the deployment and
 * reset on every cold start.
 *
 * Required env vars:
 *   RESEND_API_KEY      — Resend API key (re_...)
 *   RESEND_FROM_EMAIL   — verified sender address, e.g. hello@yourdomain.com
 *   RESEND_FROM_NAME    — (optional) sender display name, defaults to "Audema"
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY — to identify the caller and read
 *                         the suppression list and quota
 */

'use strict';

const { sign, isConfigured: unsubscribeConfigured } = require('./_lib/unsubscribe-token.js');
const { ensureComplianceFooter } = require('./_lib/compliance-footer.js');
const { authenticateSender, filterSuppressed, claimQuota, releaseQuota } =
  require('./_lib/send-guard.js');

const MAX_BATCH_SIZE     = 25;
const RATE_LIMIT_WINDOW  = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX     = 3;         // campaign sends are heavier than single sends

const rateBuckets   = new Map();

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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = getClientIp(req);
  if (!checkRateLimit(ip))
    return res.status(429).json({ error: 'Too many campaign sends. Slow down.' });

  // Who is sending. This endpoint used to accept anyone: it took a subject, a
  // body and a recipient list from any caller and sent them through the
  // account's Resend key from its verified domain, with Allow-Origin: * so a
  // page anywhere could invoke it from a browser. That is an open relay on a
  // domain with earned deliverability.
  const auth = await authenticateSender(req);
  if (auth.error) {
    const message = {
      server_unconfigured: 'SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not configured.',
      no_token: 'Sign in to send a campaign.',
      invalid_token: 'Your session has expired. Sign in again.',
      auth_unreachable: 'Could not verify your session. Nothing was sent.',
    }[auth.error] || 'Not authorised.';
    return res.status(auth.error === 'server_unconfigured' ? 500 : 401).json({ error: message });
  }
  const { userId, profile } = auth;

  const proto   = req.headers['x-forwarded-proto'] || 'https';
  const baseUrl = process.env.PUBLIC_APP_URL || `${proto}://${req.headers.host}`;

  const apiKey    = process.env.RESEND_API_KEY;
  const fromEmail = process.env.RESEND_FROM_EMAIL;
  const fromName  = process.env.RESEND_FROM_NAME || 'Audema';

  if (!apiKey)    return res.status(500).json({ error: 'RESEND_API_KEY not configured' });
  if (!fromEmail) return res.status(500).json({ error: 'RESEND_FROM_EMAIL not configured' });

  const { subject, html, text, replyTo, campaignId, recipients, companyName, mailingAddress } = req.body || {};

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

  // Nobody who has opted out, whatever the caller sent us. This is the only
  // code path that reaches Resend, so it is the only place a suppression
  // check cannot be gone around — the previous gate was client-side, in a
  // function whose behaviour depends on how a segment was configured.
  const supp = await filterSuppressed(userId, validRecipients);
  if (!supp.ok) {
    return res.status(supp.code === 'not_installed' ? 503 : 500)
      .json({ error: supp.error, code: supp.code });
  }
  const sendable = supp.allowed;
  const skippedSuppressed = supp.suppressed.map(s => ({
    to: s.to, error: `Suppressed (${s.reason}) — this address has opted out or is undeliverable`,
  }));

  if (!sendable.length) {
    return res.status(200).json({
      sent: 0, failed: 0,
      suppressed: skippedSuppressed.length,
      results: [...rejected, ...skippedSuppressed],
      note: 'Every recipient on this list has opted out or is undeliverable. Nothing was sent.',
    });
  }

  // Per account, persisted. This was a module-level counter shared by every
  // customer on the deployment and reset on every cold start, so one account
  // consumed everyone's budget while each instance kept its own tally.
  const quota = await claimQuota(userId, sendable.length, profile);
  if (!quota.ok) {
    return res.status(quota.code === 'not_installed' ? 503 : 500)
      .json({ error: quota.error, code: quota.code });
  }
  if (quota.granted <= 0) {
    return res.status(429).json({
      error: `Daily send limit of ${quota.cap} reached for this account. Resets at midnight UTC.`,
    });
  }

  const toSend = sendable.slice(0, quota.granted);
  const skippedBudget = sendable.slice(quota.granted).map(r => ({ to: r.to, error: 'Daily send limit reached' }));

  const results = [];
  let missingMailingAddress = false;

  for (const recipient of toSend) {
    const { to, toName, mergeFields, _contactId } = recipient;

    // RFC 8058 List-Unsubscribe / List-Unsubscribe-Post — Gmail, Yahoo, and
    // Apple all require these on bulk senders since May 2026 and will
    // otherwise reject or spam-box the send. The link points at
    // api/unsubscribe.js, signed so it can't be forged or reused for a
    // different recipient. Also exposed as an {{unsubscribe_url}} merge
    // token so Nova's copy can link it directly in the footer, not just
    // rely on the header mail clients don't always surface.
    const unsubToken = unsubscribeConfigured() ? sign(_contactId || null, to) : null;
    const unsubUrl = unsubToken
      ? `${baseUrl}/api/unsubscribe?c=${encodeURIComponent(_contactId || '-')}&e=${encodeURIComponent(Buffer.from(to).toString('base64url'))}&t=${unsubToken}`
      : null;
    const mergeFieldsWithUnsub = { ...(mergeFields || {}), unsubscribe_url: unsubUrl || '#' };

    const personalizedSubject = applyMergeFields(subject, mergeFieldsWithUnsub);
    const personalizedHtml    = applyMergeFields(html, mergeFieldsWithUnsub);
    const personalizedText    = text ? applyMergeFields(text, mergeFieldsWithUnsub) : undefined;

    // Same hard requirement as api/send-email.js — visible opt-out language
    // + a physical mailing address on every send, not just the invisible
    // List-Unsubscribe header above (mail clients don't all surface that to
    // the reader, and it doesn't satisfy the "physical address" requirement
    // at all). Uses the real per-recipient one-click link when available
    // rather than a generic "reply to opt out" fallback.
    const footer = ensureComplianceFooter({
      html: personalizedHtml, text: personalizedText,
      companyName, mailingAddress, replyTo, unsubscribeUrl: unsubUrl || undefined,
    });
    const resolvedReplyTo = replyTo || process.env.COMPLIANCE_REPLY_TO || fromEmail;
    if (footer.appended && !footer.hasMailingAddress) missingMailingAddress = true;

    const tags = [
      ...(campaignId  ? [{ name: 'campaign_id', value: sanitizeTagValue(campaignId) }] : []),
      ...(_contactId  ? [{ name: 'contact_id',  value: sanitizeTagValue(_contactId) }] : []),
    ];

    const payload = {
      from:     `${fromName} <${fromEmail}>`,
      to:       toName ? [`${toName} <${to}>`] : [to],
      subject:  personalizedSubject,
      html:     footer.html,
      ...(footer.text ? { text: footer.text } : {}),
      reply_to: resolvedReplyTo,
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

  // Quota is claimed before sending so two concurrent sends cannot both spend
  // the last of it. Anything claimed and not actually sent goes back, or a
  // provider outage would silently eat the day's allowance.
  await releaseQuota(userId, quota.granted - sentCount);

  const warnings = [];
  if (!unsubscribeConfigured()) {
    warnings.push('UNSUBSCRIBE_SECRET / SUPABASE_SERVICE_ROLE_KEY not configured — sends went out without List-Unsubscribe headers, which Gmail/Yahoo/Apple require for bulk senders.');
  }
  if (missingMailingAddress) {
    warnings.push('No physical mailing address configured — set one in Business Brain > Sender Identity, or COMPLIANCE_MAILING_ADDRESS, to stay compliant with CAN-SPAM/GDPR/CASL.');
  }

  return res.json({
    success:    true,
    campaignId: campaignId || null,
    sent:       sentCount,
    failed:     results.length - sentCount,
    rejected:   [...rejected, ...skippedBudget, ...skippedSuppressed],
    results,
    suppressed: skippedSuppressed.length,
    dailyLimit: quota.cap,
    ...(warnings.length ? { warnings } : {}),
  });
};
