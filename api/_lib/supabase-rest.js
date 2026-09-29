/**
 * api/_lib/supabase-rest.js — shared Supabase PostgREST helper for server-side
 * (service-role key) calls. Not a Vercel route — api/_lib/ is excluded from
 * routing, this is a plain module imported by handlers that need it.
 *
 * Mirrors the sb() helper that already lived duplicated in
 * api/cron-auto-publish.js and api/cron-agent-audit.js; factored out here
 * because this pass adds two more callers (api/unsubscribe.js,
 * api/resend-webhook.js) on top of api/send-campaign.js.
 */

'use strict';

async function sbRest(supabaseUrl, serviceKey, method, path, body) {
  const res = await fetch(`${supabaseUrl}/rest/v1${path}`, {
    method,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data };
}

/**
 * Is this a well-formed uuid?
 *
 * Every id in this schema is a uuid, and ids are interpolated straight into
 * PostgREST filter strings (`?id=eq.${x}`). A value carrying `&` adds query
 * parameters to a request the caller was not supposed to be composing: extra
 * filters cannot broaden a result (PostgREST ANDs them), but `&select=`,
 * `&limit=` and `&order=` are all reachable that way, and a request built out
 * of two people's intentions is not one anybody can reason about.
 *
 * Checking the shape is better than escaping it: a value that is not a uuid
 * was never going to match a row, so rejecting it costs a real caller nothing
 * and gives a clearer error than a PostgREST 400.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

module.exports = { sbRest, isUuid };
