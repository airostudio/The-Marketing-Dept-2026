/**
 * api/ab-track.js — A/B Test Event Ingest
 *
 * Receives visitor assignments and conversion events from the tracking snippet.
 * Called by the browser with keepalive: true so it fires even on page unload.
 *
 * POST {
 *   type:         'visit' | 'convert',
 *   experimentId: string,
 *   variantId:    string,
 *   visitorId:    string,
 *   goalId?:      string,   // required for type='convert'
 *   metadata?:    object,
 *   revenue?:     number,
 * }
 *
 * Required env vars:
 *   SUPABASE_URL              — Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY — service-role key
 */

'use strict';

async function sb(env, method, path, body) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1${path}`, {
    method,
    headers: {
      'apikey':        env.SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type':  'application/json',
      'Prefer':        'return=minimal',
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(8000),
  });
  return { ok: res.ok, status: res.status };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { type, experimentId, variantId, visitorId, goalId, metadata, revenue } = req.body || {};
  if (!type || !experimentId || !variantId || !visitorId) return res.status(400).end();

  const env = {
    SUPABASE_URL:              process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return res.status(500).end();

  try {
    if (type === 'visit') {
      // Upsert visitor — one row per (experiment, visitor)
      await sb(env, 'POST', '/visitors', {
        experiment_id: experimentId,
        variant_id:    variantId,
        visitor_id:    visitorId,
        last_seen:     new Date().toISOString(),
      });
      // Supabase upsert on conflict
      await fetch(`${env.SUPABASE_URL}/rest/v1/visitors?experiment_id=eq.${experimentId}&visitor_id=eq.${visitorId}`, {
        method: 'PATCH',
        headers: {
          'apikey':        env.SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type':  'application/json',
          'Prefer':        'return=minimal',
        },
        body: JSON.stringify({ last_seen: new Date().toISOString() }),
        signal: AbortSignal.timeout(5000),
      }).catch(() => {});
    }

    if (type === 'convert') {
      if (!goalId) return res.status(400).end();
      await sb(env, 'POST', '/conversions', {
        experiment_id: experimentId,
        variant_id:    variantId,
        goal_id:       goalId,
        visitor_id:    visitorId,
        revenue:       revenue || null,
        metadata:      metadata || {},
        converted_at:  new Date().toISOString(),
      });
    }

    return res.status(204).end();
  } catch {
    return res.status(204).end(); // Always 204 — don't break the user's page
  }
};
