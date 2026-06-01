/**
 * Send Email API — Vercel serverless function
 *
 * POST {
 *   to:       string,          // recipient email
 *   toName?:  string,
 *   subject:  string,
 *   html:     string,          // HTML body
 *   text?:    string,          // plain text fallback
 *   prospectId?: string,       // for logging
 *   sequenceId?: string,
 *   stepIndex?:  number,
 * }
 *
 * Enforces a 50 emails/day per-environment send budget to protect deliverability.
 * All credentials read from Vercel env vars — nothing client-side.
 */

'use strict';

const DAILY_SEND_LIMIT = 50;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 10;

// In-memory counters (reset on cold start; good enough for Vercel's edge)
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
  if (!b || now - b.windowStart > RATE_LIMIT_WINDOW_MS) {
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
  if (!checkRateLimit(ip)) return res.status(429).json({ error: 'Too many requests. Slow down.' });
  if (!checkDailyLimit())  return res.status(429).json({ error: `Daily send limit of ${DAILY_SEND_LIMIT} emails reached. Resets at midnight.` });

  const apiKey = process.env.SENDGRID_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'SENDGRID_API_KEY not configured' });

  const fromEmail = process.env.SENDGRID_FROM_EMAIL;
  const fromName  = process.env.SENDGRID_FROM_NAME || 'Aduma';
  if (!fromEmail) return res.status(500).json({ error: 'SENDGRID_FROM_EMAIL not configured' });

  const { to, toName, subject, html, text, prospectId, sequenceId, stepIndex } = req.body || {};

  if (!to || !subject || !html) {
    return res.status(400).json({ error: 'to, subject, and html are required' });
  }
  // Basic email format check
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    return res.status(400).json({ error: 'Invalid recipient email address' });
  }

  const payload = {
    personalizations: [{
      to: [{ email: to, ...(toName ? { name: toName } : {}) }],
    }],
    from: { email: fromEmail, name: fromName },
    subject,
    content: [
      { type: 'text/html',  value: html },
      ...(text ? [{ type: 'text/plain', value: text }] : []),
    ],
    tracking_settings: {
      click_tracking:  { enable: true },
      open_tracking:   { enable: true },
    },
    // Custom args for webhook correlation
    custom_args: {
      ...(prospectId  ? { prospect_id:  prospectId  } : {}),
      ...(sequenceId  ? { sequence_id:  sequenceId  } : {}),
      ...(stepIndex !== undefined ? { step_index: String(stepIndex) } : {}),
    },
  };

  try {
    const upstream = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });

    if (upstream.status === 202) {
      return res.json({
        success:    true,
        to,
        subject,
        dailySent:  dailySendCount,
        dailyLimit: DAILY_SEND_LIMIT,
      });
    }

    // SendGrid errors come as JSON in the body
    let errBody = {};
    try { errBody = await upstream.json(); } catch {}
    const errMsg = errBody?.errors?.[0]?.message || `SendGrid error ${upstream.status}`;
    return res.status(upstream.status).json({ error: errMsg });

  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
};
