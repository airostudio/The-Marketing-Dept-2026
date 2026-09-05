/**
 * api/stripe-webhook.js — ingests Stripe's subscription lifecycle events and
 * is the ONLY place profiles.plan/subscription_status are ever set. Checkout
 * (api/stripe-checkout.js) never writes those columns itself — it only
 * starts a session — precisely so that a completed *payment*, confirmed by
 * Stripe via this webhook, is what grants access, not a client hitting an
 * endpoint. See supabase-billing.sql's protect_billing_columns trigger for
 * the matching server-side lock (only the service-role key, used here, can
 * write these columns at all).
 *
 * Configure in the Stripe Dashboard: Developers → Webhooks → Add endpoint →
 *   URL: https://<your-domain>/api/stripe-webhook
 *   Events: checkout.session.completed, customer.subscription.updated,
 *           customer.subscription.deleted
 * Stripe hands you a signing secret (whsec_...) when you create the
 * endpoint — put it in STRIPE_WEBHOOK_SECRET.
 *
 * Stripe signs webhooks via the Stripe-Signature header: `t=<timestamp>,
 * v1=<signature>[,v0=...]`; signed content is `${timestamp}.${raw body}`;
 * signature is HMAC-SHA256(webhook secret, signed content) hex-encoded —
 * verified against the exact raw bytes of the request body, which is why
 * bodyParser is disabled below (same pattern as api/resend-webhook.js, a
 * different provider's webhook already using this exact shape).
 *
 * Required env vars:
 *   STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY — to apply the profile update
 */

'use strict';

const crypto = require('crypto');
const { sbRest } = require('./_lib/supabase-rest.js');
const { stripeRequest } = require('./_lib/stripe-rest.js');
const { planForPriceId } = require('./_lib/plans.js');

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

function verifyStripeSignature(secret, rawBody, sigHeader) {
  if (!secret || !sigHeader) return null;
  let timestamp = null;
  const signatures = [];
  for (const part of sigHeader.split(',')) {
    const [k, v] = part.split('=');
    if (k === 't') timestamp = v;
    if (k === 'v1' && v) signatures.push(v);
  }
  if (!timestamp || !signatures.length) return null;

  const signedPayload = `${timestamp}.${rawBody.toString('utf8')}`;
  const expected = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');
  const expectedBuf = Buffer.from(expected);

  const matched = signatures.some((sig) => {
    const sigBuf = Buffer.from(sig);
    return sigBuf.length === expectedBuf.length && crypto.timingSafeEqual(expectedBuf, sigBuf);
  });
  return matched ? parseInt(timestamp, 10) : null;
}

/** Mirror a Stripe subscription object onto the matching profiles row. */
async function applySubscriptionToProfile(supabaseUrl, serviceKey, subscription) {
  const priceId = subscription.items && subscription.items.data && subscription.items.data[0] &&
    subscription.items.data[0].price && subscription.items.data[0].price.id;
  const plan = (subscription.metadata && subscription.metadata.plan) || planForPriceId(priceId);
  const supabaseUserId = subscription.metadata && subscription.metadata.supabase_user_id;

  const update = {
    stripe_customer_id: subscription.customer,
    stripe_subscription_id: subscription.id,
    stripe_price_id: priceId || null,
    subscription_status: subscription.status,
    current_period_end: subscription.current_period_end
      ? new Date(subscription.current_period_end * 1000).toISOString()
      : null,
  };
  if (plan) update.plan = plan;

  const filter = supabaseUserId
    ? `id=eq.${supabaseUserId}`
    : `stripe_customer_id=eq.${subscription.customer}`;
  await sbRest(supabaseUrl, serviceKey, 'PATCH', `/profiles?${filter}`, update);
  return supabaseUserId || null;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const stripeKey     = process.env.STRIPE_SECRET_KEY;
  const supabaseUrl   = process.env.SUPABASE_URL;
  const serviceKey    = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!webhookSecret || !stripeKey || !supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: 'Stripe/Supabase env vars not fully configured.' });
  }

  const rawBody = await readRawBody(req);
  const timestamp = verifyStripeSignature(webhookSecret, rawBody, req.headers['stripe-signature']);
  if (!timestamp) return res.status(401).json({ error: 'Invalid signature' });
  if (Math.abs(Date.now() / 1000 - timestamp) > TOLERANCE_SECONDS) {
    return res.status(401).json({ error: 'Timestamp outside tolerance' });
  }

  let event;
  try {
    event = JSON.parse(rawBody.toString('utf8'));
  } catch (err) {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  // Idempotency: Stripe delivers at-least-once, so a retried event must not
  // be reprocessed (e.g. re-downgrading a plan a later event already fixed).
  const already = await sbRest(supabaseUrl, serviceKey, 'GET',
    `/billing_events?stripe_event_id=eq.${event.id}&select=id`);
  if (already.data && already.data.length) {
    return res.status(200).json({ received: true, duplicate: true });
  }

  let userId = null;
  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      userId = session.client_reference_id || (session.metadata && session.metadata.supabase_user_id) || null;
      if (session.subscription) {
        const subscription = await stripeRequest(stripeKey, 'GET', `/subscriptions/${session.subscription}`);
        userId = (await applySubscriptionToProfile(supabaseUrl, serviceKey, subscription)) || userId;
      }
    } else if (event.type === 'customer.subscription.updated') {
      userId = await applySubscriptionToProfile(supabaseUrl, serviceKey, event.data.object);
    } else if (event.type === 'customer.subscription.deleted') {
      const subscription = event.data.object;
      userId = (subscription.metadata && subscription.metadata.supabase_user_id) || null;
      const filter = userId ? `id=eq.${userId}` : `stripe_customer_id=eq.${subscription.customer}`;
      await sbRest(supabaseUrl, serviceKey, 'PATCH', `/profiles?${filter}`, {
        plan: 'free',
        subscription_status: 'canceled',
      });
    }
    // Other event types (invoice.*, payment_intent.*, etc.) are accepted
    // and logged below but don't change profile state — nothing else in
    // this pass reads them.
  } catch (err) {
    // Non-2xx tells Stripe to retry with backoff — the right response to a
    // transient Supabase/Stripe API failure, so the update isn't silently lost.
    return res.status(502).json({ error: err.message });
  }

  await sbRest(supabaseUrl, serviceKey, 'POST', '/billing_events', {
    user_id: userId,
    stripe_event_id: event.id,
    event_type: event.type,
    payload: event.data.object,
  });

  return res.status(200).json({ received: true });
};
