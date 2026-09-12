/**
 * api/_lib/stripe-rest.js — shared Stripe REST helper for server-side calls.
 * Not a Vercel route — api/_lib/ is excluded from routing, this is a plain
 * module imported by handlers that need it.
 *
 * No `stripe` npm package here (this repo has zero npm dependencies — see
 * vercel.json's buildCommand: null / api/*.js are plain Node functions with
 * no build step) — this talks to Stripe's REST API directly with fetch,
 * the same way api/admin-users.js talks to Supabase's Auth Admin REST API.
 *
 * Stripe's API takes application/x-www-form-urlencoded bodies with
 * bracket-notation for nested objects/arrays (e.g. `line_items[0][price]`),
 * not JSON — toFormBody() flattens a plain JS object into that shape.
 */

'use strict';

function toFormBody(obj) {
  const params = new URLSearchParams();
  function walk(value, prefix) {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      value.forEach((item, i) => walk(item, `${prefix}[${i}]`));
    } else if (typeof value === 'object') {
      for (const key of Object.keys(value)) {
        walk(value[key], prefix ? `${prefix}[${key}]` : key);
      }
    } else {
      params.append(prefix, String(value));
    }
  }
  walk(obj, '');
  return params;
}

async function stripeRequest(secretKey, method, path, params) {
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params ? toFormBody(params).toString() : undefined,
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error((data && data.error && data.error.message) || `Stripe API error (${res.status})`);
    err.stripeError = data && data.error;
    err.status = res.status;
    throw err;
  }
  return data;
}

module.exports = { stripeRequest, toFormBody };
