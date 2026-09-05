/**
 * api/stripe-checkout.js — start a Stripe Checkout subscription for the
 * signed-in user's chosen plan.
 *
 * Card capture happens entirely on Stripe's hosted Checkout page — this
 * endpoint only creates/reuses the Stripe Customer and the Checkout
 * Session, then hands the browser the redirect URL. profiles.plan itself is
 * only ever updated by api/stripe-webhook.js once Stripe confirms payment —
 * never here, so a user can't grant themselves a plan by hitting this
 * endpoint and abandoning checkout.
 *
 * POST { plan, interval? } — interval is 'month' (default) or 'year'.
 * Header: Authorization: Bearer <the caller's own Supabase access token>
 *
 * Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY,
 *   plus one STRIPE_PRICE_<PLAN>_<INTERVAL> per self-serve plan (api/_lib/plans.js).
 */

'use strict';

const { sbRest } = require('./_lib/supabase-rest.js');
const { stripeRequest } = require('./_lib/stripe-rest.js');
const { resolvePriceId } = require('./_lib/plans.js');

async function getCallerFromToken(supabaseUrl, serviceKey, accessToken) {
  const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return null;
  return res.json();
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const stripeKey   = process.env.STRIPE_SECRET_KEY;
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: 'SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not configured.' });
  }
  if (!stripeKey) {
    return res.status(500).json({ error: 'STRIPE_SECRET_KEY not configured. See VERCEL_SETUP.md → Billing (Stripe) setup.' });
  }

  const accessToken = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
  if (!accessToken) return res.status(401).json({ error: 'Missing Authorization header.' });

  const caller = await getCallerFromToken(supabaseUrl, serviceKey, accessToken);
  if (!caller?.id) return res.status(401).json({ error: 'Invalid or expired session.' });

  const { plan, interval = 'month' } = req.body || {};
  if (!plan) return res.status(400).json({ error: 'plan is required' });

  const priceId = resolvePriceId(plan, interval);
  if (!priceId) {
    return res.status(400).json({
      error: `No Stripe price configured for plan "${plan}" (${interval}ly). Enterprise/Agency Enterprise are custom-priced — contact sales instead of checkout.`,
    });
  }

  const proto   = req.headers['x-forwarded-proto'] || 'https';
  const baseUrl = process.env.PUBLIC_APP_URL || `${proto}://${req.headers.host}`;

  try {
    // Reuse an existing Stripe Customer if this account already has one.
    const profileLookup = await sbRest(supabaseUrl, serviceKey, 'GET',
      `/profiles?id=eq.${caller.id}&select=stripe_customer_id,email`);
    const existing = profileLookup.data && profileLookup.data[0];
    let customerId = existing && existing.stripe_customer_id;

    if (!customerId) {
      const customer = await stripeRequest(stripeKey, 'POST', '/customers', {
        email: caller.email,
        metadata: { supabase_user_id: caller.id },
      });
      customerId = customer.id;
      // service_role write — bypasses the protect_billing_columns trigger,
      // which exists precisely to block everyone else from setting this.
      await sbRest(supabaseUrl, serviceKey, 'PATCH', `/profiles?id=eq.${caller.id}`, {
        stripe_customer_id: customerId,
      });
    }

    const session = await stripeRequest(stripeKey, 'POST', '/checkout/sessions', {
      mode: 'subscription',
      customer: customerId,
      client_reference_id: caller.id,
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: { metadata: { supabase_user_id: caller.id, plan } },
      success_url: `${baseUrl}/billing.html?checkout=success`,
      cancel_url: `${baseUrl}/billing.html?checkout=cancelled`,
    });

    return res.json({ url: session.url });
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
};
