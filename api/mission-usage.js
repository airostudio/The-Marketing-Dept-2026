/**
 * api/mission-usage.js — the Agent Mission meter.
 *
 * The Agent Mission is the unit every pricing tier is sold on, so this is
 * where a plan stops being a label and starts being a limit.
 *
 * POST { action: 'check' }    → current usage, writes nothing
 * POST { action: 'consume' }  → increments and returns the new state,
 *                               or 402 when the allowance is spent
 * Header: Authorization: Bearer <the caller's own Supabase access token>
 *
 * Follows api/generate-ad-image.js's gate: check the allowance BEFORE the
 * expensive work, refuse with a 402 and an upgrade link when it's gone.
 *
 * The count is kept server-side deliberately. MissionStore is localStorage,
 * which the customer can clear — fine for "what am I working on", useless as
 * a billing record.
 *
 * Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

'use strict';

const { sbRest } = require('./_lib/supabase-rest.js');
const { missionAllowanceFor, currentPeriod, PLAN_LABELS, isAllowanceConfirmed } =
  require('./_lib/plan-limits.js');

async function getCallerFromToken(supabaseUrl, serviceKey, accessToken) {
  const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return null;
  return res.json();
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;

  // Metering that cannot reach its own store must not silently block work.
  // An unconfigured deployment is an operator problem, not a customer one —
  // the same call this app already makes for AI image credits.
  if (!supabaseUrl || !serviceKey) {
    return res.json({
      metered: false,
      allowed: true,
      reason: 'Mission metering is not configured on this deployment (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing), so missions are not being counted.',
    });
  }

  const accessToken = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
  if (!accessToken) return res.status(401).json({ error: 'Missing Authorization header.' });

  const caller = await getCallerFromToken(supabaseUrl, serviceKey, accessToken);
  if (!caller?.id) return res.status(401).json({ error: 'Invalid or expired session.' });

  const action = (req.body && req.body.action) || 'check';
  const period = currentPeriod();

  // Plan + any admin-set override.
  const profRes = await sbRest(supabaseUrl, serviceKey, 'GET',
    `/profiles?id=eq.${caller.id}&select=plan,mission_limit`);
  const profile = (profRes.ok && profRes.data && profRes.data[0]) || {};
  const plan = profile.plan || 'free';
  const limit = missionAllowanceFor(plan, profile.mission_limit);

  const usageRes = await sbRest(supabaseUrl, serviceKey, 'GET',
    `/mission_usage?user_id=eq.${caller.id}&period=eq.${period}&select=used`);
  const used = (usageRes.ok && usageRes.data && usageRes.data[0] && usageRes.data[0].used) || 0;

  const uncapped = limit === null;
  const remaining = uncapped ? null : Math.max(0, limit - used);

  const base = {
    metered: true,
    plan,
    planLabel: PLAN_LABELS[plan] || plan,
    period,
    used,
    limit,
    remaining,
    uncapped,
    // Per plan, not a single global flag. The five standard tiers are
    // confirmed; the Agency figures are still scaled guesses, and quoting one
    // of those to a paying agency as settled policy is exactly what this flag
    // exists to prevent.
    provisionalAllowance: !uncapped && !isAllowanceConfirmed(plan, profile.mission_limit),
  };

  if (action === 'check') {
    return res.json(Object.assign({ allowed: uncapped || remaining > 0 }, base));
  }

  if (action !== 'consume') {
    return res.status(400).json({ error: `Unknown action "${action}". Use 'check' or 'consume'.` });
  }

  // ── consume ─────────────────────────────────────────────────────────────
  //
  // The allowance check and the increment are one statement in the database,
  // not a comparison here followed by a write. Deciding in JavaScript on the
  // `used` value read above would let an account on its last mission fire ten
  // at once: all ten read the same count, all ten pass, all ten increment.
  // consume_mission_usage() takes the row lock that serialises them.
  const conRes = await sbRest(supabaseUrl, serviceKey, 'POST',
    '/rpc/consume_mission_usage', { uid: caller.id, p: period, lim: uncapped ? null : limit });

  if (!conRes.ok) {
    // Do not block the customer's work because our counter is broken; record
    // that it failed so it shows up rather than silently under-counting.
    console.error('[mission-usage] consume failed:', conRes.status, conRes.data);
    return res.json(Object.assign({ allowed: true, counted: false,
      reason: 'Mission allowed, but the usage counter could not be updated.' }, base));
  }

  // The function returns a one-row table, which PostgREST sends as an array.
  const row = (Array.isArray(conRes.data) ? conRes.data[0] : conRes.data) || {};
  const newUsed = Number.isFinite(row.used) ? row.used : used;
  const withCount = Object.assign({}, base, {
    used: newUsed,
    remaining: uncapped ? null : Math.max(0, limit - newUsed),
  });

  if (row.allowed === false) {
    return res.status(402).json(Object.assign({
      error: 'mission_limit_reached',
      allowed: false,
      message: `You've used all ${limit} Agent Missions included with the ${PLAN_LABELS[plan] || plan} plan this month. ` +
               `The allowance resets at the start of next month.`,
      upgradeUrl: '/billing.html',
    }, withCount));
  }

  return res.json(Object.assign(withCount, { allowed: true, counted: true }));
};
