/**
 * api/_lib/plans.js — canonical plan → Stripe price env var mapping.
 *
 * The plan enum itself is defined (and enforced) in
 * supabase-intelligence-profiles.sql's profiles_plan_check constraint; this
 * file is the one place that maps each self-serve plan to the Stripe Price
 * ID env vars the user configures in Vercel (see VERCEL_SETUP.md's Stripe
 * setup section). 'enterprise' and 'agency_enterprise' are intentionally
 * absent — both are custom-priced, sold off-platform, never through
 * Checkout, so there's no price ID to look up for them.
 */

'use strict';

const SELF_SERVE_PLANS = {
  start:          { monthly: 'STRIPE_PRICE_START_MONTHLY',          yearly: 'STRIPE_PRICE_START_YEARLY' },
  growth:         { monthly: 'STRIPE_PRICE_GROWTH_MONTHLY',         yearly: 'STRIPE_PRICE_GROWTH_YEARLY' },
  scale:          { monthly: 'STRIPE_PRICE_SCALE_MONTHLY',          yearly: 'STRIPE_PRICE_SCALE_YEARLY' },
  autonomous:     { monthly: 'STRIPE_PRICE_AUTONOMOUS_MONTHLY',     yearly: 'STRIPE_PRICE_AUTONOMOUS_YEARLY' },
  agency_starter: { monthly: 'STRIPE_PRICE_AGENCY_STARTER_MONTHLY', yearly: 'STRIPE_PRICE_AGENCY_STARTER_YEARLY' },
  agency_growth:  { monthly: 'STRIPE_PRICE_AGENCY_GROWTH_MONTHLY',  yearly: 'STRIPE_PRICE_AGENCY_GROWTH_YEARLY' },
  agency_pro:     { monthly: 'STRIPE_PRICE_AGENCY_PRO_MONTHLY',     yearly: 'STRIPE_PRICE_AGENCY_PRO_YEARLY' },
};

/** Resolve a plan+interval to a configured Stripe Price ID, or null if unset/unknown. */
function resolvePriceId(plan, interval) {
  const envVars = SELF_SERVE_PLANS[plan];
  if (!envVars) return null;
  const envVar = interval === 'year' ? envVars.yearly : envVars.monthly;
  return process.env[envVar] || null;
}

/** Reverse lookup: given a Stripe Price ID, which plan is it (for the webhook). */
function planForPriceId(priceId) {
  for (const [plan, envVars] of Object.entries(SELF_SERVE_PLANS)) {
    if (process.env[envVars.monthly] === priceId || process.env[envVars.yearly] === priceId) return plan;
  }
  return null;
}

module.exports = { SELF_SERVE_PLANS, resolvePriceId, planForPriceId };
