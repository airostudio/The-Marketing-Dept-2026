/**
 * api/track-conversion.js — report an order so campaign revenue can be real.
 *
 * POST { email, amount, currency?, externalId?, occurredAt?, campaignId? }
 * Header: Authorization: Bearer <CONVERSION_API_KEY>
 *
 * Called by the customer's own shop or order webhook. Revenue happens on
 * their site, not in this app, so it cannot be derived from email data — the
 * only honest options are to be told, or to leave the column blank. Per-campaign
 * revenue was blank for exactly that reason; this is the "be told" half.
 *
 * ── The attribution rule, stated rather than assumed ─────────────────────
 *
 * An order is credited to the campaign the buyer most recently CLICKED before
 * the order, within ATTRIBUTION_WINDOW_DAYS. Failing that, to the campaign
 * they most recently OPENED in the same window. Failing that, to nothing.
 *
 * Last-click within a window is a convention, not a truth: somebody who
 * clicked a newsletter and then bought after seeing a billboard is credited to
 * the newsletter. Every row records which rule fired, and orders that match no
 * campaign are stored with attribution 'none' and excluded from campaign
 * revenue — rather than being spread across campaigns, or quietly dropped so
 * the totals look tidier than the evidence.
 *
 * Authenticated with a separate CONVERSION_API_KEY rather than a user session:
 * the caller is a server on the customer's side, not a signed-in browser.
 *
 * Required env vars:
 *   CONVERSION_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * Optional: ATTRIBUTION_WINDOW_DAYS (default 7)
 */

'use strict';

const { sbRest } = require('./_lib/supabase-rest.js');
const { withFailureReporting } = require('./_lib/report-failure.js');

const DEFAULT_WINDOW_DAYS = 7;
const MAX_AMOUNT_CENTS = 100_000_000;   // A$1,000,000 — a typo guard, not a policy

function windowDays() {
  const n = parseInt(process.env.ATTRIBUTION_WINDOW_DAYS, 10);
  return Number.isFinite(n) && n > 0 && n <= 90 ? n : DEFAULT_WINDOW_DAYS;
}

/** Money as integer cents. Floats lose money at the third decimal. */
function toCents(amount) {
  if (typeof amount === 'number' && isFinite(amount)) return Math.round(amount * 100);
  if (typeof amount === 'string' && /^\d+(\.\d{1,2})?$/.test(amount.trim())) {
    return Math.round(parseFloat(amount) * 100);
  }
  return null;
}

module.exports = withFailureReporting('api/track-conversion', async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const expected = process.env.CONVERSION_API_KEY;
  if (!expected) {
    return res.status(500).json({
      error: 'CONVERSION_API_KEY is not configured — refusing to accept unauthenticated revenue.',
    });
  }
  const given = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
  if (given !== expected) return res.status(401).json({ error: 'Unauthorized' });

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: 'SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not configured.' });
  }

  const body = req.body || {};
  const email = String(body.email || '').trim().toLowerCase();
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'A valid email is required.' });
  }

  const cents = toCents(body.amount);
  if (cents === null || cents < 0) {
    return res.status(400).json({ error: 'amount must be a non-negative number, e.g. 49.95.' });
  }
  if (cents > MAX_AMOUNT_CENTS) {
    return res.status(400).json({ error: 'amount looks wrong — over the per-order ceiling.' });
  }

  const currency = String(body.currency || 'AUD').toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    return res.status(400).json({ error: 'currency must be a 3-letter code.' });
  }

  const occurredAt = body.occurredAt ? new Date(body.occurredAt) : new Date();
  if (isNaN(occurredAt)) return res.status(400).json({ error: 'occurredAt is not a valid date.' });

  const sb = (m, p, b) => sbRest(supabaseUrl, serviceKey, m, p, b);

  // Which account does this address belong to? Revenue must land on the right
  // customer's books, and the caller does not get to assert whose.
  const cRes = await sb('GET',
    `/contacts?email=eq.${encodeURIComponent(email)}&select=id,user_id&limit=1`);
  if (!cRes.ok) {
    if (cRes.status === 404) {
      return res.status(503).json({ code: 'not_installed',
        error: 'Contacts are not installed. Run supabase-audience.sql.' });
    }
    return res.status(500).json({ error: `Could not look up the contact (HTTP ${cRes.status}).` });
  }
  const contact = cRes.data && cRes.data[0];
  if (!contact) {
    // Not a known contact, so not attributable to any campaign of ours. Said
    // plainly rather than stored against a guessed account.
    return res.status(404).json({
      code: 'unknown_contact',
      error: 'No contact with that email address. The order was not recorded, because there is ' +
             'no account it could belong to.',
    });
  }

  const since = new Date(occurredAt.getTime() - windowDays() * 86400000).toISOString();

  // Last click, then last open, inside the window and before the order.
  async function lastCampaign(eventType) {
    const r = await sb('GET',
      `/email_events?contact_id=eq.${contact.id}&event_type=eq.${eventType}` +
      `&occurred_at=gte.${since}&occurred_at=lte.${occurredAt.toISOString()}` +
      `&campaign_id=not.is.null&order=occurred_at.desc&limit=1`);
    return (r.ok && r.data && r.data[0]) || null;
  }

  let campaignId = null;
  let attribution = 'none';

  if (body.campaignId) {
    // The caller named the campaign — a shop that carries the id through its
    // own checkout knows better than any inference we could make.
    campaignId = String(body.campaignId);
    attribution = 'direct';
  } else {
    const click = await lastCampaign('clicked');
    if (click) {
      campaignId = click.campaign_id;
      attribution = 'click';
    } else {
      const open = await lastCampaign('opened');
      if (open) {
        campaignId = open.campaign_id;
        attribution = 'open';
      }
    }
  }

  const row = {
    user_id: contact.user_id,
    campaign_id: campaignId,
    contact_id: contact.id,
    email,
    attribution,
    amount_cents: cents,
    currency,
    external_id: body.externalId ? String(body.externalId).slice(0, 200) : null,
    occurred_at: occurredAt.toISOString(),
  };

  const ins = await sb('POST', '/email_conversions', row);

  // A conflict is the same order reported twice — an order webhook retrying,
  // which is normal. Counting it again would inflate revenue, so it is
  // reported as a duplicate rather than as an error or as a second sale.
  if (!ins.ok) {
    if (ins.status === 409) {
      return res.status(200).json({ ok: true, duplicate: true,
        note: 'An order with this externalId was already recorded; it has not been counted twice.' });
    }
    if (ins.status === 404) {
      return res.status(503).json({ code: 'not_installed',
        error: 'Conversion tracking is not installed. Run supabase-email-engine.sql.' });
    }
    return res.status(500).json({ error: `Could not record the conversion (HTTP ${ins.status}).` });
  }

  return res.status(200).json({
    ok: true,
    attribution,
    campaignId,
    amountCents: cents,
    currency,
    note: attribution === 'none'
      ? `No click or open from this contact in the ${windowDays()} days before the order, so it is ` +
        'recorded but credited to no campaign. It is deliberately excluded from campaign revenue ' +
        'rather than assigned to the nearest one.'
      : undefined,
  });
});

module.exports.toCents = toCents;
module.exports.windowDays = windowDays;
