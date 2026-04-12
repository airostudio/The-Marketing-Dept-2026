/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * EMAIL VERIFICATION API — Vercel Serverless Function
 *
 * Priority order:
 *   1. Hunter.io  (set HUNTER_API_KEY  in Vercel env)
 *   2. ZeroBounce (set ZEROBOUNCE_API_KEY in Vercel env)
 *   3. Built-in   format + disposable-domain check (always available, free)
 *
 * Response shape (all tiers return the same contract):
 * {
 *   email:       string,
 *   result:      'deliverable' | 'risky' | 'undeliverable' | 'unknown',
 *   score:       number (0-100),
 *   disposable:  boolean,
 *   webmail:     boolean,
 *   reason:      string,   // human-readable explanation
 *   source:      'hunter' | 'zerobounce' | 'built-in'
 * }
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// Commonly-used free / disposable email domains (built-in fallback)
const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com','guerrillamail.com','tempmail.com','throwaway.email',
  'yopmail.com','sharklasers.com','guerrillamailblock.com','grr.la',
  'trashmail.at','dispostable.com','maildrop.cc','spam4.me','getairmail.com',
  'filzmail.com','throwam.com','spamgourmet.com','trashmail.com',
  'tempr.email','discard.email','fakeinbox.com','mailnesia.com',
  'mytemp.email','temp-mail.org','emailfake.com','nada.email',
]);

const WEBMAIL_DOMAINS = new Set([
  'gmail.com','yahoo.com','hotmail.com','outlook.com','icloud.com',
  'aol.com','protonmail.com','zoho.com','mail.com','live.com',
  'msn.com','me.com','mac.com','ymail.com','rocketmail.com',
]);

function basicValidate(email) {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  if (!re.test(email)) {
    return { result: 'undeliverable', score: 0, reason: 'Invalid email format', disposable: false, webmail: false };
  }
  const domain = email.split('@')[1].toLowerCase();
  const disposable = DISPOSABLE_DOMAINS.has(domain);
  const webmail    = WEBMAIL_DOMAINS.has(domain);
  if (disposable) {
    return { result: 'undeliverable', score: 10, reason: 'Disposable/temporary email address', disposable: true, webmail: false };
  }
  return {
    result:     'unknown',
    score:      webmail ? 55 : 70,
    reason:     webmail ? 'Valid format — webmail address (lower deliverability for B2B)' : 'Valid format — domain not verified without API key',
    disposable: false,
    webmail,
  };
}

async function verifyWithHunter(email, apiKey) {
  const url = `https://api.hunter.io/v2/email-verifier?email=${encodeURIComponent(email)}&api_key=${apiKey}`;
  const res  = await fetch(url);
  if (!res.ok) throw new Error(`Hunter.io API error ${res.status}`);
  const json = await res.json();
  const d    = json.data || {};

  const statusMap = { valid: 'deliverable', invalid: 'undeliverable', unknown: 'unknown', webmail: 'risky', accept_all: 'risky' };
  return {
    result:     statusMap[d.result] || 'unknown',
    score:      d.score ?? 50,
    reason:     d.result === 'valid' ? 'Verified by Hunter.io' : `Hunter.io: ${d.result || 'unknown'}`,
    disposable: d.disposable || false,
    webmail:    d.webmail    || false,
  };
}

async function verifyWithZeroBounce(email, apiKey) {
  const url = `https://api.zerobounce.net/v2/validate?api_key=${apiKey}&email=${encodeURIComponent(email)}`;
  const res  = await fetch(url);
  if (!res.ok) throw new Error(`ZeroBounce API error ${res.status}`);
  const d = await res.json();

  const statusMap = { valid: 'deliverable', invalid: 'undeliverable', catch_all: 'risky', unknown: 'unknown', spamtrap: 'undeliverable', abuse: 'risky', do_not_mail: 'undeliverable' };
  return {
    result:     statusMap[d.status] || 'unknown',
    score:      d.status === 'valid' ? 90 : d.status === 'catch_all' ? 50 : 10,
    reason:     `ZeroBounce: ${d.status}${d.sub_status ? ` (${d.sub_status})` : ''}`,
    disposable: (d.sub_status === 'disposable') || false,
    webmail:    d.free_email || false,
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email } = req.body || {};
  if (!email || typeof email !== 'string') {
    return res.status(400).json({ error: 'email field required' });
  }

  const trimmed = email.trim().toLowerCase();

  // Rate-limit guard — basic format check before hitting paid APIs
  const formatCheck = basicValidate(trimmed);
  if (formatCheck.result === 'undeliverable' && formatCheck.score === 0) {
    return res.status(200).json({ email: trimmed, ...formatCheck, source: 'built-in' });
  }

  const hunterKey     = process.env.HUNTER_API_KEY;
  const zeroBounceKey = process.env.ZEROBOUNCE_API_KEY;

  try {
    if (hunterKey) {
      const result = await verifyWithHunter(trimmed, hunterKey);
      return res.status(200).json({ email: trimmed, ...result, source: 'hunter' });
    }
    if (zeroBounceKey) {
      const result = await verifyWithZeroBounce(trimmed, zeroBounceKey);
      return res.status(200).json({ email: trimmed, ...result, source: 'zerobounce' });
    }
    // No API keys configured — return best-effort built-in result
    return res.status(200).json({ email: trimmed, ...formatCheck, source: 'built-in' });
  } catch (err) {
    console.error('[verify-email] API error:', err.message);
    // Fall back to built-in if paid API fails
    return res.status(200).json({ email: trimmed, ...formatCheck, source: 'built-in', warning: err.message });
  }
}
