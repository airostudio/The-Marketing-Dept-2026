/**
 * api/resend-webhook.js — ingests Resend's delivery-event webhooks
 * (bounce, complaint) so contacts.status actually gets updated instead of
 * silently rotting. This is the other half of the Pat/Email Delivery audit
 * finding: the QA gate and send limits were real, but nothing closed the
 * loop when a send later bounced or was marked as spam.
 *
 * Configure in the Resend dashboard: Webhooks → Add Endpoint →
 *   URL: https://<your-domain>/api/resend-webhook
 *   Events: email.bounced, email.complained
 * Resend hands you a signing secret (whsec_...) when you create the
 * endpoint — put it in RESEND_WEBHOOK_SECRET.
 *
 * Resend signs webhooks the same way Svix does: headers svix-id,
 * svix-timestamp, svix-signature; signed content is
 * `${svix-id}.${svix-timestamp}.${raw body}`; the secret's base64 portion
 * (after the whsec_ prefix) is base64-decoded to raw key bytes; the
 * signature is HMAC-SHA256(key, signedContent) then base64-encoded;
 * svix-signature carries one or more space-separated `v1,<sig>` entries to
 * check against (rotation support) — verified against the exact raw bytes
 * of the request body, which is why bodyParser is disabled below.
 *
 * Required env vars:
 *   RESEND_WEBHOOK_SECRET — the whsec_... signing secret from Resend
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY — to apply the status update
 */

'use strict';

const crypto = require('crypto');
const { sbRest } = require('./_lib/supabase-rest.js');

module.exports.config = { api: { bodyParser: false } };

const TOLERANCE_SECONDS = 300; // reject signatures on requests older/newer than 5 min — replay protection

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function verifySignature(secret, id, timestamp, rawBody, signatureHeader) {
  if (!secret || !id || !timestamp || !signatureHeader) return false;
  let keyBytes;
  try {
    keyBytes = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  } catch (err) {
    return false;
  }
  const signedContent = `${id}.${timestamp}.${rawBody.toString('utf8')}`;
  const expected = crypto.createHmac('sha256', keyBytes).update(signedContent).digest('base64');

  return signatureHeader.split(' ').some((entry) => {
    const [, sig] = entry.split(',');
    if (!sig) return false;
    const a = Buffer.from(expected);
    const b = Buffer.from(sig);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return res.status(500).json({ error: 'RESEND_WEBHOOK_SECRET not configured' });

  const rawBody = await readRawBody(req);
  const id        = req.headers['svix-id'];
  const timestamp = req.headers['svix-timestamp'];
  const signature = req.headers['svix-signature'];

  if (!verifySignature(secret, id, timestamp, rawBody, signature)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const ts = parseInt(timestamp, 10);
  if (!ts || Math.abs(Date.now() / 1000 - ts) > TOLERANCE_SECONDS) {
    return res.status(401).json({ error: 'Timestamp outside tolerance' });
  }

  let event;
  try {
    event = JSON.parse(rawBody.toString('utf8'));
  } catch (err) {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  const type = event && event.type;
  const data = (event && event.data) || {};
  const tags = data.tags || {};
  const contactId = tags.contact_id;

  // Only a permanent bounce or a spam complaint suppresses future sends —
  // a transient bounce (full mailbox, greylisting) isn't a reason to stop
  // emailing someone, so it's intentionally left unhandled here.
  let newStatus = null;
  if (type === 'email.complained') newStatus = 'complained';
  if (type === 'email.bounced' && data.bounce && data.bounce.type === 'Permanent') newStatus = 'bounced';

  if (newStatus && contactId) {
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (supabaseUrl && serviceKey) {
      await sbRest(supabaseUrl, serviceKey, 'PATCH', `/contacts?id=eq.${encodeURIComponent(contactId)}`, { status: newStatus });
    }
  }

  // 200 + no body is all Resend/Svix requires to consider this delivered —
  // returning JSON here is just for anyone poking the endpoint by hand.
  return res.status(200).json({ received: true });
};
