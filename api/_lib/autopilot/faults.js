/**
 * api/_lib/autopilot/faults.js — what kind of problem an agent hit, and what
 * the autopilot does about it on its own.
 *
 * Every fault is put in one of these kinds, each with a repair:
 *   transient       a service hiccup (5xx, timeout, dropped connection):
 *                   wait a little longer each time and try again
 *   rate_limited    the service asked us to slow down: wait as long as it
 *                   says (or a sensible while) and try again
 *   model           the AI's answer was unusable: ask again
 *   site_unreachable the business's own website didn't answer: try again
 *                   later in the day
 *   auth            a login was refused or expired: stop and ask the
 *                   business to reconnect — never guess or retry a password
 *   not_configured  Audema itself is missing a setting: stop, tell the
 *                   business plainly, and alert Audema's team
 *   permanent       anything else that will not fix itself by waiting
 */

'use strict';

const POLICY = {
  transient:        { retries: 5, waitsMin: [2, 5, 15, 60, 180], fix: 'waited and tried again' },
  rate_limited:     { retries: 6, waitsMin: [15, 30, 60, 120, 240, 480], fix: 'slowed down as the service asked, then tried again' },
  model:            { retries: 3, waitsMin: [2, 5, 15], fix: 'asked the AI again' },
  site_unreachable: { retries: 3, waitsMin: [30, 120, 360], fix: 'waited for the website to come back, then tried again' },
  auth:             { retries: 0 },
  not_configured:   { retries: 0 },
  permanent:        { retries: 0 },
};

/**
 * @param {Error} err  any error; .kind, .status and .retryAfterMs are honoured
 * @returns {{kind: string, retryAfterMs: number|null}}
 */
function classify(err) {
  const e = err || {};
  if (e.kind && POLICY[e.kind]) return { kind: e.kind, retryAfterMs: e.retryAfterMs || null };
  const status = Number(e.status) || 0;
  const msg = `${e.name || ''} ${e.message || ''} ${e.code || ''}`;
  if (status === 401 || status === 403) return { kind: 'auth', retryAfterMs: null };
  if (status === 429 || /rate.?limit|too many requests|quota/i.test(msg)) return { kind: 'rate_limited', retryAfterMs: e.retryAfterMs || null };
  if (status >= 500 || status === 408 || /timeout|timed out|took too long|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|socket hang up|fetch failed|network|overloaded|AbortError/i.test(msg)) return { kind: 'transient', retryAfterMs: null };
  return { kind: 'permanent', retryAfterMs: null };
}

/**
 * What to do after a fault at a given attempt (0-based) of a step.
 * @returns {{action: 'retry', waitMs: number, fix: string} | {action: 'ask_permission'} | {action: 'give_up', reason: string}}
 */
function decide(kind, attempt, retryAfterMs) {
  const p = POLICY[kind] || POLICY.permanent;
  if (kind === 'auth') return { action: 'ask_permission' };
  if (attempt < p.retries) {
    const waitMin = p.waitsMin[Math.min(attempt, p.waitsMin.length - 1)];
    return { action: 'retry', waitMs: Math.max(retryAfterMs || 0, waitMin * 60000), fix: p.fix };
  }
  if (kind === 'not_configured') return { action: 'give_up', reason: 'Audema is missing a setting it needs for this.' };
  return { action: 'give_up', reason: p.retries ? `It kept failing after ${p.retries} tries over several hours.` : 'This will not fix itself by waiting.' };
}

/** A short, plain description of a fault for the "What happened" inbox. */
function describe(kind, err) {
  const m = String((err && err.message) || 'unknown error').replace(/\s+/g, ' ').slice(0, 220);
  return {
    transient: `A service didn't respond properly (${m})`,
    rate_limited: `A service asked us to slow down (${m})`,
    model: `The AI's answer couldn't be used (${m})`,
    site_unreachable: `Your website didn't answer (${m})`,
    auth: `A login was refused (${m})`,
    not_configured: `Audema is missing a setting (${m})`,
    permanent: m,
  }[kind] || m;
}

module.exports = { classify, decide, describe, POLICY };
