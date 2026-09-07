/**
 * api/unsubscribe.js — public, no-login-required unsubscribe endpoint.
 *
 * This is the landing page behind every campaign email's List-Unsubscribe
 * link (see api/send-campaign.js), and the target of the one-click POST
 * mail clients like Gmail/Yahoo send when a subscriber uses the built-in
 * "Unsubscribe" option next to the sender name (RFC 8058).
 *
 *   GET  /api/unsubscribe?c=<contactId|->&e=<base64url email>&t=<token>
 *        Shows a confirmation page with a form that POSTs to the same URL.
 *        A bare GET never unsubscribes anyone by itself — that would let a
 *        link-scanning bot (many corporate mail gateways prefetch links)
 *        silently unsubscribe real subscribers who never clicked anything.
 *
 *   POST /api/unsubscribe?c=...&e=...&t=...
 *        Actually flips the contact's status. This is what RFC 8058
 *        one-click unsubscribe POSTs directly, and what the confirmation
 *        page's form submits to.
 *
 * The token is an HMAC over (contactId, email) — see
 * api/_lib/unsubscribe-token.js — so this endpoint can trust the request
 * without a login, but can't be forged or replayed against a different
 * contact.
 *
 * Only contacts that came from the audience/contacts table (i.e. had a
 * contactId at send time) actually get flipped to 'unsubscribed' — an
 * ad-hoc pasted recipient with no CRM record has nothing to update, and
 * still sees the confirmation page rather than a confusing error.
 *
 * Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (to apply the
 * status change), and whatever api/_lib/unsubscribe-token.js uses to sign
 * (UNSUBSCRIBE_SECRET or SUPABASE_SERVICE_ROLE_KEY).
 */

'use strict';

const { verify } = require('./_lib/unsubscribe-token.js');
const { sbRest } = require('./_lib/supabase-rest.js');

function decodeEmail(e) {
  try {
    return Buffer.from(String(e || ''), 'base64url').toString('utf8');
  } catch (err) {
    return null;
  }
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function page(title, bodyHtml) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    background: #0d0d1a;
    color: #f1f5f9;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    margin: 0;
    padding: 24px;
  }
  .card {
    max-width: 420px;
    width: 100%;
    background: #12121f;
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 16px;
    padding: 32px;
    text-align: center;
  }
  h1 { font-size: 20px; margin: 0 0 12px; }
  p { color: #94a3b8; font-size: 14px; line-height: 1.6; margin: 0 0 22px; }
  button {
    background: linear-gradient(135deg, #7c3aed, #ec4899);
    color: #fff;
    border: none;
    border-radius: 8px;
    padding: 12px 26px;
    font-size: 14px;
    font-weight: 700;
    font-family: inherit;
    cursor: pointer;
  }
  button:hover { opacity: 0.92; }
</style>
</head>
<body><div class="card">${bodyHtml}</div></body>
</html>`;
}

async function flipContactStatus(contactId, status) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey || !contactId) return false;
  const { ok } = await sbRest(supabaseUrl, serviceKey, 'PATCH', `/contacts?id=eq.${encodeURIComponent(contactId)}`, { status });
  return ok;
}

/**
 * Record the address itself as suppressed, whether or not it is a contact.
 *
 * Unsubscribe used to be keyed entirely on contact_id, so a recipient who had
 * been pasted into an ad-hoc send had nothing to update — clicking the link
 * recorded nothing at all, while the confirmation page told them they would
 * not be emailed again. The next send to the same pasted list mailed them.
 *
 * The suppression list is keyed on the address, so the promise the page makes
 * is one the system can actually keep. api/send-campaign.js and
 * api/send-email.js both check it before every send.
 */
async function suppressAddress(contactId, email) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey || !email) return false;

  // Which account is this suppression for? A contact row names it directly.
  // Without one, fall back to any account that has previously sent to this
  // address — the send is what created the relationship being ended.
  let userId = null;
  if (contactId) {
    const c = await sbRest(supabaseUrl, serviceKey, 'GET',
      `/contacts?id=eq.${encodeURIComponent(contactId)}&select=user_id&limit=1`);
    if (c.ok && c.data && c.data[0]) userId = c.data[0].user_id;
  }
  if (!userId) {
    const s = await sbRest(supabaseUrl, serviceKey, 'GET',
      `/campaign_sends?email=eq.${encodeURIComponent(email)}&select=user_id&order=created_at.desc&limit=1`);
    if (s.ok && s.data && s.data[0]) userId = s.data[0].user_id;
  }
  if (!userId) return false;

  const res = await sbRest(supabaseUrl, serviceKey, 'POST',
    '/email_suppressions?on_conflict=user_id,email', {
      user_id: userId,
      email: String(email).trim().toLowerCase(),
      reason: 'unsubscribed',
      source: 'unsubscribe link',
    });
  return res.ok || res.status === 409;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { c, e, t } = req.query || {};
  const contactId = c && c !== '-' ? String(c) : null;
  const email = decodeEmail(e);

  res.setHeader('Content-Type', 'text/html; charset=utf-8');

  if (!email || !verify(contactId, email, t)) {
    return res.status(400).send(page('Link expired', `
      <h1>This link is no longer valid</h1>
      <p>The unsubscribe link has expired or was altered. If you'd like to stop receiving email from us, reply to any of our messages and we'll remove you by hand.</p>
    `));
  }

  if (req.method === 'POST') {
    await flipContactStatus(contactId, 'unsubscribed');
    const suppressed = await suppressAddress(contactId, email);

    // Only promise what was actually recorded. If neither the contact status
    // nor the suppression list could be written, saying "you won't receive
    // email from us again" would be a claim about something that did not
    // happen — and about a legal right.
    return res.status(200).send(page('Unsubscribed', suppressed
      ? `<h1>You're unsubscribed</h1>
         <p><strong>${escapeHtml(email)}</strong> won't receive marketing email from us again.</p>`
      : `<h1>We couldn't complete that</h1>
         <p>Something went wrong recording the opt-out for <strong>${escapeHtml(email)}</strong>,
         so we can't promise it has taken effect. Please reply to any of our messages and
         we'll remove you by hand.</p>`));
  }

  const actionUrl = `/api/unsubscribe?c=${encodeURIComponent(contactId || '-')}&e=${encodeURIComponent(e)}&t=${encodeURIComponent(t)}`;
  return res.status(200).send(page('Unsubscribe', `
    <h1>Unsubscribe ${escapeHtml(email)}?</h1>
    <p>You'll stop receiving marketing email from us. This won't affect any other accounts or services.</p>
    <form method="POST" action="${actionUrl}">
      <button type="submit">Confirm unsubscribe</button>
    </form>
  `));
};
