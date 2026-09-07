/**
 * api/campaign-stats.js — real engagement figures for a campaign.
 *
 * POST { campaignId }
 * Header: Authorization: Bearer <the caller's own Supabase access token>
 *
 * ── The distinction this endpoint exists to make ─────────────────────────
 *
 * "0% open rate" and "opens are not being tracked" produce the same number
 * and mean opposite things. The first says nobody opened the campaign; the
 * second says nobody counted. Before this, the app could only ever say the
 * first — api/resend-webhook.js ignored open and click events entirely, so
 * campaign.stats.opens was 0 for every campaign ever sent, and the UI
 * presented that as a measured result.
 *
 * Open and click tracking are also switched on per domain in the Resend
 * dashboard and are off by default. So even with the webhook fixed, an
 * account can legitimately have delivery events and no open events. That is
 * reported as `openTracking: 'not-recorded'` rather than as 0%.
 *
 * Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

'use strict';

const { sbRest } = require('./_lib/supabase-rest.js');

async function getCallerFromToken(supabaseUrl, serviceKey, accessToken) {
  const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return null;
  return res.json();
}

/** Percentage, or null when the denominator is not a real measurement. */
function rate(numerator, denominator) {
  if (!denominator || denominator <= 0) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
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
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: 'SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not configured.' });
  }

  const accessToken = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
  if (!accessToken) return res.status(401).json({ error: 'Missing Authorization header.' });

  const caller = await getCallerFromToken(supabaseUrl, serviceKey, accessToken);
  if (!caller?.id) return res.status(401).json({ error: 'Invalid or expired session.' });

  const campaignId = (req.body && req.body.campaignId) || '';
  if (!campaignId || typeof campaignId !== 'string') {
    return res.status(400).json({ error: 'campaignId is required.' });
  }

  // Counted in Postgres. A busy campaign is hundreds of thousands of event
  // rows and none of them need to reach the browser to be tallied.
  const q = await sbRest(supabaseUrl, serviceKey, 'POST', '/rpc/campaign_email_stats', {
    cid: campaignId,
    uid: caller.id,
  });

  if (!q.ok) {
    if (q.status === 404) {
      return res.status(503).json({
        code: 'not_installed',
        error: 'Email event tracking is not installed. Run supabase-email-events.sql in the ' +
               'Supabase SQL editor, then subscribe the Resend webhook to the email.* events.',
      });
    }
    return res.status(500).json({ error: `Could not read email events (HTTP ${q.status}).` });
  }

  // Revenue, if any orders have been reported for this campaign. This is a
  // separate table with its own installation state: a campaign can have full
  // engagement data and no revenue data, because revenue arrives from the
  // customer's own shop via api/track-conversion.js and many accounts will
  // never wire that up.
  let revenue = null;
  const rev = await sbRest(supabaseUrl, serviceKey, 'POST', '/rpc/campaign_revenue', {
    cid: campaignId, uid: caller.id,
  });
  if (rev.ok) {
    const rr = (Array.isArray(rev.data) ? rev.data[0] : rev.data) || {};
    const conversions = Number(rr.conversions || 0);
    revenue = {
      available: true,
      conversions,
      // Null rather than 0 when nothing has been reported: "this campaign
      // earned nothing" and "no orders have ever been reported to us" are
      // different claims, and only one of them is ours to make.
      amountCents: conversions > 0 ? Number(rr.revenue_cents || 0) : null,
      currency: rr.currency || null,
      note: conversions === 0
        ? 'No orders have been attributed to this campaign. Revenue is reported by your shop ' +
          'through /api/track-conversion — if that is not wired up, this stays blank rather ' +
          'than showing zero.'
        : undefined,
    };
  } else {
    revenue = {
      available: false,
      reason: rev.status === 404
        ? 'Revenue attribution is not installed — run supabase-email-engine.sql.'
        : `Could not read conversions (HTTP ${rev.status}).`,
    };
  }

  const row = (Array.isArray(q.data) ? q.data[0] : q.data) || {};
  const sent      = Number(row.sent || 0);
  const delivered = Number(row.delivered || 0);
  const opened    = Number(row.opened || 0);
  const uniqOpen  = Number(row.unique_opened || 0);
  const clicked   = Number(row.clicked || 0);
  const uniqClick = Number(row.unique_clicked || 0);
  const bounced   = Number(row.bounced || 0);
  const complained = Number(row.complained || 0);

  const anyEvents = sent + delivered + opened + clicked + bounced + complained > 0;

  // Rates are measured against what was delivered, not what was handed to
  // Resend: an address that bounced never had the chance to open.
  const base = delivered || sent;

  // The three states that a single "0%" used to collapse into.
  const openTracking =
    !anyEvents ? 'no-events'
    : uniqOpen > 0 ? 'tracked'
    : 'not-recorded';

  const clickTracking =
    !anyEvents ? 'no-events'
    : uniqClick > 0 ? 'tracked'
    : 'not-recorded';

  return res.json({
    campaignId,
    counts: { sent, delivered, opened, uniqueOpened: uniqOpen, clicked, uniqueClicked: uniqClick, bounced, complained },

    rates: {
      // Null, never 0, when there is no denominator or nothing was recorded.
      // A null renders as "—" and a 0 renders as "nobody", and only one of
      // those is honest about an untracked campaign.
      delivered:   rate(delivered, sent),
      openRate:    openTracking === 'tracked' ? rate(uniqOpen, base) : null,
      clickRate:   clickTracking === 'tracked' ? rate(uniqClick, base) : null,
      // Click-to-open is a different measure from click rate and was
      // previously computed and then labelled as the latter.
      clickToOpen: (openTracking === 'tracked' && clickTracking === 'tracked')
        ? rate(uniqClick, uniqOpen) : null,
      bounceRate:  rate(bounced, sent),
      complaintRate: rate(complained, sent),
    },

    openTracking,
    clickTracking,
    revenue,

    // Said in words, because a dashboard cell has no room to explain itself.
    notes: {
      'no-events': 'No delivery events have been received for this campaign yet. ' +
        'Either it has not been sent, or the Resend webhook is not pointed at ' +
        '/api/resend-webhook.',
      'not-recorded': 'Delivery events arrived but no opens or clicks were among them. ' +
        'Open and click tracking are enabled per domain in the Resend dashboard and are ' +
        'off by default — until they are on, this is not a measurement of zero engagement.',
      'tracked': null,
    }[openTracking],

    firstEvent: row.first_event || null,
    lastEvent:  row.last_event || null,
  });
};
