/**
 * api/_lib/plan-limits.js — how much work each plan is entitled to.
 *
 * The Agent Mission is the unit the pricing is built on: customers are not
 * limited to a few agents, they have the whole department and are limited by
 * how much work it performs. This is the one place those allowances live.
 *
 * ── Which allowances are settled, and which are still guesses ────────────
 * The published pricing describes allowances qualitatively — Start gets
 * "limited monthly Agent Missions", Growth a "substantially larger monthly
 * Agent Mission allowance" — without stating figures, so every number here
 * began as a placeholder scaled to the price points.
 *
 * The five standard tiers have since been confirmed. The Agency tiers have
 * not: they are priced by client count and no per-tier mission figure has
 * been set, so the values below are still scaled guesses.
 *
 * That is why this is a set rather than a boolean. A single flag would have
 * to be flipped all-or-nothing, and flipping it would quote an invented
 * Agency Pro allowance to a paying agency as settled policy. Naming the
 * confirmed plans lets the UI say "provisional" for exactly those tiers where
 * it is still true.
 */

'use strict';

/**
 * Plans whose mission allowance is a confirmed commercial decision.
 * Anything not listed here is enforced, but is shown to the customer as
 * provisional.
 */
const CONFIRMED_ALLOWANCES = new Set([
  'free', 'start', 'growth', 'scale', 'autonomous',
]);

/**
 * Monthly Agent Mission allowance per plan.
 * null = uncapped (Enterprise tiers are negotiated individually; a per-account
 * override on profiles.mission_limit takes precedence over anything here).
 */
const MISSION_ALLOWANCES = {
  // Confirmed.
  free:               3,
  start:             20,
  growth:            60,
  scale:            150,
  autonomous:       500,
  enterprise:      null,

  // Agency tiers are pooled across the agency's client businesses, matching
  // "agency users then purchase additional marketing capacity where
  // necessary" — capacity is bought at the account level, not per client.
  // These figures are NOT confirmed: see CONFIRMED_ALLOWANCES above. They are
  // enforced so the mechanism works, and reported to the customer as
  // provisional so nobody plans against a number that may move.
  agency_starter:   100,
  agency_growth:    300,
  agency_pro:      1000,
  agency_enterprise: null,
};

const PLAN_LABELS = {
  free: 'Free', start: 'Start', growth: 'Growth', scale: 'Scale',
  autonomous: 'Autonomous', enterprise: 'Enterprise',
  agency_starter: 'Agency Starter', agency_growth: 'Agency Growth',
  agency_pro: 'Agency Pro', agency_enterprise: 'Agency Enterprise',
};

/**
 * List price per month, in AUD, for revenue reporting.
 *
 * null means the plan is negotiated individually and its value is NOT
 * knowable from the plan name — Enterprise and both Agency Enterprise tiers
 * are custom-priced, and the Agency tiers were described by client count
 * rather than by a published price. Accounts on a null-priced plan are
 * counted and reported separately rather than folded into MRR at zero, which
 * would understate revenue, or at a guess, which would invent it.
 *
 * Autonomous is published as a A$2,999–A$4,999 range; the lower bound is used
 * so the figure is a floor rather than an optimistic estimate.
 */
const PLAN_MONTHLY_PRICE_AUD = {
  free:               0,
  start:            299,
  growth:           749,
  scale:           1499,
  autonomous:      2999,   // range 2999-4999; floor used deliberately
  enterprise:      null,   // custom
  agency_starter:  null,   // priced by client count, not published
  agency_growth:   null,
  agency_pro:      null,
  agency_enterprise: null,
};

/** Subscription statuses that represent revenue actually being collected. */
const REVENUE_STATUSES = ['active', 'trialing'];

/**
 * @param {string} plan
 * @param {number|null} [override] profiles.mission_limit, if an admin set one
 * @returns {number|null} null means uncapped
 */
function missionAllowanceFor(plan, override) {
  if (override !== undefined && override !== null && override !== '') {
    const n = Number(override);
    if (isFinite(n) && n >= 0) return n;
  }
  const key = String(plan || 'free');
  return Object.prototype.hasOwnProperty.call(MISSION_ALLOWANCES, key)
    ? MISSION_ALLOWANCES[key]
    : MISSION_ALLOWANCES.free;
}

/**
 * Is this plan's allowance a settled figure the customer can rely on?
 *
 * An uncapped plan counts as settled: there is no number to confirm, and
 * calling "unlimited" provisional would be a warning about nothing.
 * An account with an admin-set override is also settled — somebody chose that
 * number for this account deliberately.
 */
function isAllowanceConfirmed(plan, override) {
  if (override !== undefined && override !== null && override !== '') return true;
  const key = String(plan || 'free');
  if (MISSION_ALLOWANCES[key] === null) return true;   // uncapped
  return CONFIRMED_ALLOWANCES.has(key);
}

/** Current billing-usage period. Calendar month, matching "monthly allowance". */
function currentPeriod(now) {
  const d = now ? new Date(now) : new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

module.exports = {
  MISSION_ALLOWANCES, PLAN_LABELS, CONFIRMED_ALLOWANCES,
  PLAN_MONTHLY_PRICE_AUD, REVENUE_STATUSES,
  missionAllowanceFor, isAllowanceConfirmed, currentPeriod,
};
