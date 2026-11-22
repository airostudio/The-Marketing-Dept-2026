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

const { readCampaignMetrics } = require('./_lib/campaign-metrics.js');
const { withFailureReporting } = require('./_lib/report-failure.js');

async function getCallerFromToken(supabaseUrl, serviceKey, accessToken) {
  const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return null;
  return res.json();
}

module.exports = withFailureReporting('api/campaign-stats', async function handler(req, res) {
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
  // rows and none of them need to reach the browser to be tallied. The figures
  // (and the honest "not recorded" states) are built in
  // api/_lib/campaign-metrics.js, shared with the analytics mission.
  const m = await readCampaignMetrics(supabaseUrl, serviceKey, campaignId, caller.id);
  if (!m.ok) {
    if (m.notInstalled) {
      return res.status(503).json({
        code: 'not_installed',
        error: 'Email event tracking is not installed. Run supabase-email-events.sql in the ' +
               'Supabase SQL editor, then subscribe the Resend webhook to the email.* events.',
      });
    }
    return res.status(500).json({ error: `Could not read email events (HTTP ${m.status}).` });
  }
  return res.json(m.stats);
});
