/**
 * api/stripe-portal.js — returns a Stripe Customer Portal session URL for
 * the signed-in user, so they can update their card, view invoices,
 * switch plan, or cancel — all on Stripe's own hosted page. No card data,
 * plan changes, or cancellations touch this app directly; the matching
 * subscription-lifecycle events land back on api/stripe-webhook.js.
 *
 * POST {} — no body needed.
 * Header: Authorization: Bearer <the caller's own Supabase access token>
 *
 * Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY
 */

'use strict';

const { sbRest } = require('./_lib/supabase-rest.js');
const { stripeRequest } = require('./_lib/stripe-rest.js');

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

  const proto   = req.headers['x-forwarded-proto'] || 'https';
  const baseUrl = process.env.PUBLIC_APP_URL || `${proto}://${req.headers.host}`;

  try {
    const profileLookup = await sbRest(supabaseUrl, serviceKey, 'GET',
      `/profiles?id=eq.${caller.id}&select=stripe_customer_id`);
    const customerId = profileLookup.data && profileLookup.data[0] && profileLookup.data[0].stripe_customer_id;
    if (!customerId) {
      return res.status(400).json({ error: "You don't have a billing account yet — subscribe to a plan first." });
    }

    const session = await stripeRequest(stripeKey, 'POST', '/billing_portal/sessions', {
      customer: customerId,
      return_url: `${baseUrl}/billing.html`,
    });

    return res.json({ url: session.url });
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
};
