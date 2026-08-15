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

module.exports = { sbRest };
