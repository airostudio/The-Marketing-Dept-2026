/**
 * api/_lib/campaign-metrics.js — turn one campaign's raw event tallies and
 * revenue rows into honest figures. Shared by api/campaign-stats.js (one
 * campaign's dashboard) and the analytics mission (api/_lib/analytics-facts.js),
 * so a number means the same thing wherever it is quoted.
 *
 * The distinction it exists to keep: "0% open rate" and "opens are not being
 * tracked" mean opposite things. Rates are null — never 0 — when there is no
 * denominator or nothing was recorded, and openTracking/clickTracking say
 * which of 'no-events' | 'not-recorded' | 'tracked' applies.
 */

'use strict';

const { sbRest } = require('./supabase-rest.js');

/** Percentage to one decimal, or null when the denominator is not a real measurement. */
function rate(numerator, denominator) {
  if (!denominator || denominator <= 0) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

/**
 * Read one campaign's stats + revenue (Postgres counts them; none of the event
 * rows reach this process) and return the figures.
 * @returns {Promise<{ok:true, stats:object} | {ok:false, status:number, notInstalled:boolean}>}
 */
async function readCampaignMetrics(supabaseUrl, serviceKey, campaignId, userId) {
  const q = await sbRest(supabaseUrl, serviceKey, 'POST', '/rpc/campaign_email_stats', { cid: campaignId, uid: userId });
  if (!q.ok) return { ok: false, status: q.status, notInstalled: q.status === 404 };

  // Revenue, if any orders have been reported for this campaign. This is a
  // separate table with its own installation state: a campaign can have full
  // engagement data and no revenue data, because revenue arrives from the
  // customer's own shop via api/track-conversion.js and many accounts will
  // never wire that up.
  let revenue = null;
  const rev = await sbRest(supabaseUrl, serviceKey, 'POST', '/rpc/campaign_revenue', {
    cid: campaignId, uid: userId,
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

  return {
    ok: true,
    stats: {
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
    },
  };
}

module.exports = { readCampaignMetrics, rate };
