/**
 * api/admin-metrics.js — cross-account aggregates for the admin dashboard.
 *
 * Server-side and admin-gated for the same reason api/admin-users.js is:
 * this reads every account's plan, subscription state and usage. RLS does let
 * an admin read those tables from the browser, but doing the aggregation
 * client-side would mean shipping the whole customer list to the page to
 * count it. The counting happens here; only the totals go over the wire.
 *
 * POST {}  (auth via the caller's own bearer token)
 * Header: Authorization: Bearer <Supabase access token>
 *
 * ── On honesty in the numbers ────────────────────────────────────────────
 * Every figure returned says what it is derived from, and anything that
 * cannot be known is reported as unknown rather than as zero:
 *
 *  - MRR covers only the plans with a published price. Enterprise and the
 *    Agency tiers are negotiated individually, so their accounts are counted
 *    separately under `customPricedAccounts` instead of being folded in at
 *    zero (which understates revenue) or at a guess (which invents it).
 *  - A table that doesn't exist yet — the migration hasn't been run — is
 *    reported as `available: false`, which is a different state from a table
 *    that exists and is empty. A dashboard cannot tell those apart from a
 *    count of zero, and the difference matters.
 *
 * Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

'use strict';

const { sbRest } = require('./_lib/supabase-rest.js');
const { withFailureReporting } = require('./_lib/report-failure.js');
const {
  PLAN_LABELS, PLAN_MONTHLY_PRICE_AUD, REVENUE_STATUSES,
  MISSION_ALLOWANCES, currentPeriod,
} = require('./_lib/plan-limits.js');

async function getCallerFromToken(supabaseUrl, serviceKey, accessToken) {
  const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return null;
  return res.json();
}

async function getCallerRole(supabaseUrl, serviceKey, userId) {
  const res = await sbRest(supabaseUrl, serviceKey, 'GET', `/profiles?id=eq.${userId}&select=role`);
  return (res.ok && res.data && res.data[0] && res.data[0].role) || null;
}

/** Fetch a table, distinguishing "not migrated yet" from "empty". */
async function tryFetch(supabaseUrl, serviceKey, pathname) {
  const res = await sbRest(supabaseUrl, serviceKey, 'GET', pathname);
  if (res.ok) return { available: true, rows: res.data || [] };
  // PostgREST answers 404 for an unknown relation.
  return {
    available: false,
    rows: [],
    reason: res.status === 404
      ? 'This table does not exist yet — the migration for it has not been run.'
      : `Could not read this table (HTTP ${res.status}).`,
  };
}

function lastNMonths(n) {
  const out = [];
  const d = new Date();
  d.setUTCDate(1);
  for (let i = n - 1; i >= 0; i--) {
    const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1));
    out.push(`${m.getUTCFullYear()}-${String(m.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

module.exports = withFailureReporting('api/admin-metrics', async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: 'SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not configured.' });
  }

  const accessToken = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
  if (!accessToken) return res.status(401).json({ error: 'Missing Authorization header.' });

  const caller = await getCallerFromToken(supabaseUrl, serviceKey, accessToken);
  if (!caller?.id) return res.status(401).json({ error: 'Invalid or expired session.' });

  const role = await getCallerRole(supabaseUrl, serviceKey, caller.id);
  if (role !== 'admin' && role !== 'super_admin') {
    return res.status(403).json({ error: 'Admin privileges required.' });
  }

  // ── Accounts ────────────────────────────────────────────────────────────
  const profiles = await tryFetch(supabaseUrl, serviceKey,
    '/profiles?select=id,plan,role,subscription_status,current_period_end,created_at&limit=10000');

  const byPlan = {};
  const byStatus = {};
  const signupsByMonth = {};
  let mrr = 0;
  let customPricedAccounts = 0;
  let payingAccounts = 0;

  const months = lastNMonths(6);
  months.forEach(m => { signupsByMonth[m] = 0; });

  profiles.rows.forEach(p => {
    const plan = p.plan || 'free';
    byPlan[plan] = (byPlan[plan] || 0) + 1;

    const status = p.subscription_status || 'none';
    byStatus[status] = (byStatus[status] || 0) + 1;

    if (p.created_at) {
      const m = String(p.created_at).slice(0, 7);
      if (Object.prototype.hasOwnProperty.call(signupsByMonth, m)) signupsByMonth[m]++;
    }

    // Revenue: only from a subscription that is actually collecting, and only
    // from a plan whose price is published.
    if (REVENUE_STATUSES.includes(p.subscription_status)) {
      payingAccounts++;
      const price = PLAN_MONTHLY_PRICE_AUD[plan];
      if (typeof price === 'number') mrr += price;
      else customPricedAccounts++;   // Enterprise/Agency — value not knowable here
    }
  });

  // ── Mission usage ───────────────────────────────────────────────────────
  const usage = await tryFetch(supabaseUrl, serviceKey,
    '/mission_usage?select=user_id,period,used&limit=10000');

  const missionsByMonth = {};
  months.forEach(m => { missionsByMonth[m] = 0; });
  let accountsAtOrOverLimit = 0;

  const planById = {};
  profiles.rows.forEach(p => { planById[p.id] = p.plan || 'free'; });

  const thisPeriod = currentPeriod();
  usage.rows.forEach(u => {
    if (Object.prototype.hasOwnProperty.call(missionsByMonth, u.period)) {
      missionsByMonth[u.period] += (u.used || 0);
    }
    if (u.period === thisPeriod) {
      const limit = MISSION_ALLOWANCES[planById[u.user_id] || 'free'];
      if (typeof limit === 'number' && (u.used || 0) >= limit) accountsAtOrOverLimit++;
    }
  });

  // ── Billing events ──────────────────────────────────────────────────────
  const events = await tryFetch(supabaseUrl, serviceKey,
    '/billing_events?select=event_type,created_at&order=created_at.desc&limit=500');

  const eventsByType = {};
  events.rows.forEach(e => { eventsByType[e.event_type] = (eventsByType[e.event_type] || 0) + 1; });

  return res.json({
    generatedAt: new Date().toISOString(),
    period: thisPeriod,

    accounts: {
      available: profiles.available,
      reason: profiles.reason,
      total: profiles.rows.length,
      byPlan,
      byStatus,
      signupsByMonth,
      admins: profiles.rows.filter(p => p.role === 'admin' || p.role === 'super_admin').length,
    },

    revenue: {
      // Named so nobody reads it as exact: it is a floor over published prices.
      estimatedMrrAud: Math.round(mrr),
      payingAccounts,
      customPricedAccounts,
      basis: 'Sum of published monthly prices for accounts whose subscription is active or trialing. ' +
             'Autonomous is counted at its A$2,999 lower bound. Enterprise and Agency accounts are ' +
             'negotiated individually and are counted separately, not included in this figure.',
      pricedPlans: Object.entries(PLAN_MONTHLY_PRICE_AUD)
        .filter(([, v]) => typeof v === 'number' && v > 0)
        .map(([k, v]) => ({ plan: k, label: PLAN_LABELS[k], monthlyAud: v })),
    },

    missions: {
      available: usage.available,
      reason: usage.reason,
      byMonth: missionsByMonth,
      thisPeriodTotal: missionsByMonth[thisPeriod] || 0,
      accountsAtOrOverLimit,
    },

    billingEvents: {
      available: events.available,
      reason: events.reason,
      total: events.rows.length,
      byType: eventsByType,
      note: events.available && events.rows.length === 0
        ? 'No Stripe webhook events have been received yet. This is empty until Stripe is connected and a real event arrives.'
        : undefined,
    },

    planLabels: PLAN_LABELS,
  });
});
