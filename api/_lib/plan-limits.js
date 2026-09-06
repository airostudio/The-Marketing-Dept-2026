/**
 * api/_lib/plan-limits.js — how much work each plan is entitled to.
 *
 * The Agent Mission is the unit the pricing is built on: customers are not
 * limited to a few agents, they have the whole department and are limited by
 * how much work it performs. This is the one place those allowances live.
 *
 * ── The numbers are placeholders and are marked as such ──────────────────
 * The published pricing describes allowances qualitatively — Start gets
 * "limited monthly Agent Missions", Growth a "substantially larger monthly
 * Agent Mission allowance" — without stating figures. The values below are
 * scaled to the price points so the mechanism is real and testable, but they
 * are a commercial decision, not a technical one. Change them here and
 * nothing else needs touching. Until they are confirmed, the UI says the
 * allowance is provisional rather than quoting it as settled policy.
 */

'use strict';

const PLACEHOLDER_ALLOWANCES = true; // flip to false once the real numbers are set

/**
 * Monthly Agent Mission allowance per plan.
 * null = uncapped (Enterprise tiers are negotiated individually; a per-account
 * override on profiles.mission_limit takes precedence over anything here).
 */
const MISSION_ALLOWANCES = {
  free:               3,
  start:             20,
  growth:            60,
  scale:            150,
  autonomous:       500,
  enterprise:      null,

  // Agency tiers are pooled across the agency's client businesses, matching
  // "agency users then purchase additional marketing capacity where
  // necessary" — capacity is bought at the account level, not per client.
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

/** Current billing-usage period. Calendar month, matching "monthly allowance". */
function currentPeriod(now) {
  const d = now ? new Date(now) : new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

module.exports = {
  MISSION_ALLOWANCES, PLAN_LABELS, PLACEHOLDER_ALLOWANCES,
  missionAllowanceFor, currentPeriod,
};
