/**
 * api/convert-experiments.js — Convert.com A/B Experiment Data Proxy
 *
 * Fetches live experiment performance from Convert.com's REST API and returns
 * structured results that the Ad Creative Lab can use to inform new ad variants.
 *
 * GET  /api/convert-experiments             — list all active/finished experiments
 * GET  /api/convert-experiments?id=<expId>  — single experiment with variant stats
 *
 * Required env vars:
 *   CONVERT_API_KEY     — Convert.com API key
 *   CONVERT_API_SECRET  — Convert.com API secret
 *
 * Convert REST API docs: https://api.convert.com/doc/converting/
 */

'use strict';

const CONVERT_API_BASE = 'https://api.convert.com/api/v1';
const RATE_LIMIT_WINDOW = 60 * 1000;
const RATE_LIMIT_MAX    = 20;
const rateBuckets       = new Map();

function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) return fwd.split(',')[0].trim();
  return req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
}

function checkRateLimit(ip) {
  const now = Date.now();
  let b = rateBuckets.get(ip);
  if (!b || now - b.windowStart > RATE_LIMIT_WINDOW) {
    b = { windowStart: now, count: 0 };
    rateBuckets.set(ip, b);
  }
  b.count++;
  return b.count <= RATE_LIMIT_MAX;
}

// Derive a Basic auth header from the Convert key/secret pair
function convertAuthHeader(apiKey, apiSecret) {
  const creds = Buffer.from(`${apiKey}:${apiSecret}`).toString('base64');
  return `Basic ${creds}`;
}

// Summarise a single experiment into a clean object for the frontend
function summariseExperiment(exp, stats) {
  const variations = exp.variations || [];
  let winnerVariant = null;
  let topUplift     = 0;

  const variantSummaries = variations.map(v => {
    const vStats = stats?.find(s => String(s.variation_id) === String(v.id)) || {};
    const conv   = vStats.conversions || 0;
    const visits  = vStats.visitors   || 0;
    const rate    = visits > 0 ? (conv / visits * 100).toFixed(2) : null;
    const uplift  = vStats.improvement !== undefined ? parseFloat(vStats.improvement).toFixed(1) + '%' : null;

    if (uplift && parseFloat(vStats.improvement) > topUplift) {
      topUplift    = parseFloat(vStats.improvement);
      winnerVariant = { name: v.name, uplift };
    }

    return {
      id:           v.id,
      name:         v.name,
      isControl:    v.is_baseline || false,
      visitors:     visits,
      conversions:  conv,
      convRate:     rate ? rate + '%' : null,
      uplift,
      status:       vStats.status || null,
    };
  });

  const isWinner = exp.status === 'finished' && winnerVariant !== null;

  return {
    id:             exp.id,
    name:           exp.name,
    status:         exp.status,
    type:           exp.type,
    startDate:      exp.start_time,
    endDate:        exp.end_time,
    goal:           exp.primary_metric?.name || null,
    totalVisitors:  variantSummaries.reduce((s, v) => s + v.visitors, 0),
    winner:         isWinner,
    winnerVariant:  isWinner ? winnerVariant : null,
    variants:       variantSummaries,
  };
}

// Build a human-readable "top performer" string across all experiments
function deriveTopPerformer(experiments) {
  const withWinners = experiments.filter(e => e.winner && e.winnerVariant);
  if (!withWinners.length) return null;
  const best = withWinners.sort((a, b) =>
    parseFloat(b.winnerVariant.uplift) - parseFloat(a.winnerVariant.uplift)
  )[0];
  return `"${best.winnerVariant.name}" in "${best.name}" (+${best.winnerVariant.uplift})`;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const ip = getClientIp(req);
  if (!checkRateLimit(ip)) return res.status(429).json({ error: 'Too many requests' });

  const apiKey    = process.env.CONVERT_API_KEY;
  const apiSecret = process.env.CONVERT_API_SECRET;

  if (!apiKey || !apiSecret) {
    return res.status(500).json({
      error: 'Convert.com API credentials not configured. Add CONVERT_API_KEY and CONVERT_API_SECRET in Vercel environment variables.',
      setupUrl: 'https://app.convert.com/account/api',
    });
  }

  const authHeader = convertAuthHeader(apiKey, apiSecret);
  const singleId   = req.query?.id;

  try {
    if (singleId) {
      // ── Single experiment detail ─────────────────────────────────────────
      const [expRes, statsRes] = await Promise.all([
        fetch(`${CONVERT_API_BASE}/accounts/current/experiments/${singleId}`, {
          headers: { Authorization: authHeader, Accept: 'application/json' },
          signal: AbortSignal.timeout(12000),
        }),
        fetch(`${CONVERT_API_BASE}/accounts/current/experiments/${singleId}/stats`, {
          headers: { Authorization: authHeader, Accept: 'application/json' },
          signal: AbortSignal.timeout(12000),
        }),
      ]);

      if (!expRes.ok) {
        const err = await expRes.json().catch(() => ({}));
        return res.status(expRes.status).json({ error: err.message || `Convert API ${expRes.status}` });
      }

      const exp   = await expRes.json();
      const stats = statsRes.ok ? (await statsRes.json().catch(() => [])) : [];
      return res.json(summariseExperiment(exp, stats?.variations || []));

    } else {
      // ── List all experiments (last 90 days, active + finished) ───────────
      const listRes = await fetch(`${CONVERT_API_BASE}/accounts/current/experiments?per_page=50&status[]=active&status[]=finished`, {
        headers: { Authorization: authHeader, Accept: 'application/json' },
        signal: AbortSignal.timeout(15000),
      });

      if (!listRes.ok) {
        const err = await listRes.json().catch(() => ({}));
        return res.status(listRes.status).json({ error: err.message || `Convert API ${listRes.status}` });
      }

      const listData    = await listRes.json();
      const rawExps     = listData.data || listData.experiments || listData || [];

      // Fetch stats for up to 10 most recent experiments in parallel
      const recentExps = rawExps.slice(0, 10);
      const statsResults = await Promise.allSettled(
        recentExps.map(exp =>
          fetch(`${CONVERT_API_BASE}/accounts/current/experiments/${exp.id}/stats`, {
            headers: { Authorization: authHeader, Accept: 'application/json' },
            signal: AbortSignal.timeout(8000),
          }).then(r => r.ok ? r.json() : { variations: [] })
        )
      );

      const experiments = recentExps.map((exp, i) => {
        const statsResult = statsResults[i];
        const stats = statsResult.status === 'fulfilled' ? (statsResult.value?.variations || []) : [];
        return summariseExperiment(exp, stats);
      });

      // Include older experiments (without stats) for the overview
      const olderExps = rawExps.slice(10).map(exp => summariseExperiment(exp, []));
      const allExps   = [...experiments, ...olderExps];

      return res.json({
        success:       true,
        total:         rawExps.length,
        experiments:   allExps,
        topPerformer:  deriveTopPerformer(allExps),
        fetchedAt:     new Date().toISOString(),
      });
    }
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
};
