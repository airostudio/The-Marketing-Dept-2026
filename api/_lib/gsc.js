/**
 * api/_lib/gsc.js — read a business's Google Search Console data through its
 * own signed-in connection (read-only), and make sense of it.
 *
 *   performance(sb, conn, { days, endOffsetDays, dimension, rowLimit })
 *       clicks / impressions / CTR / average position per page or query.
 *       Search Console's numbers lag about two days, so periods end 3 days ago.
 *   compare(now, before)   per-page movement between two periods
 *   strikingDistance(queries, { covered })
 *       searches the site already shows up for on page 1–2 (position 8–20)
 *       with real impressions: the quickest wins for a new article.
 */

'use strict';

const oauth = require('./oauth.js');

const DAY = 86400000;
const ymd = (t) => new Date(t).toISOString().slice(0, 10);
const round = (n, d = 1) => Math.round(Number(n || 0) * 10 ** d) / 10 ** d;

function period(days, endOffsetDays = 3, now = Date.now()) {
  const end = now - endOffsetDays * DAY;
  return { startDate: ymd(end - (days - 1) * DAY), endDate: ymd(end) };
}

async function query(sb, conn, body, deps = {}) {
  const secret = await oauth.fresh(sb, conn, deps);
  const property = conn.config && conn.config.property;
  if (!property) throw oauth.fail('No Search Console site is chosen for this connection.', 400, 'auth', { connectionId: conn.id, connectionLabel: conn.label });
  try {
    return await oauth.http(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(property)}/searchAnalytics/query`, {
      method: 'POST', headers: { Authorization: `Bearer ${secret.accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }, 'Search Console', deps);
  } catch (e) {
    if (e.kind === 'auth') { e.connectionId = conn.id; e.connectionLabel = conn.label; }
    throw e;
  }
}

/** One period of performance, grouped by page or query. */
async function performance(sb, conn, { days = 28, endOffsetDays = 3, dimension = 'page', rowLimit = 250, now } = {}, deps = {}) {
  const p = period(days, endOffsetDays, now || (deps.now ? deps.now() : Date.now()));
  const [rows, total] = await Promise.all([
    query(sb, conn, { ...p, dimensions: [dimension], rowLimit, dataState: 'final' }, deps),
    query(sb, conn, { ...p, rowLimit: 1, dataState: 'final' }, deps),
  ]);
  const t = (total.rows || [])[0] || {};
  return {
    ...p,
    totals: { clicks: t.clicks || 0, impressions: t.impressions || 0, ctr: round((t.ctr || 0) * 100, 2), position: round(t.position || 0) },
    rows: (rows.rows || []).map(r => ({ [dimension]: r.keys[0], clicks: r.clicks || 0, impressions: r.impressions || 0, ctr: round((r.ctr || 0) * 100, 2), position: round(r.position || 0) })),
  };
}

/** Per-page movement: position goes DOWN when a page improves. */
const pageKey = (u) => String(u || '').replace(/\/+$/, '').toLowerCase();
function compare(now, before) {
  const prev = new Map((before || []).map(r => [pageKey(r.page), r]));
  return (now || []).map(r => {
    const b = prev.get(pageKey(r.page));
    return { ...r, before: b ? { clicks: b.clicks, impressions: b.impressions, position: b.position } : null, positionChange: b ? round(b.position - r.position) : null, clickChange: b ? r.clicks - b.clicks : null };
  });
}

function norm(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim(); }

/** Searches on page 1–2 with real impressions that no existing topic or article covers. */
function strikingDistance(queries, { covered = [], minImpressions = 30, limit = 5 } = {}) {
  const have = covered.map(norm).filter(Boolean);
  return (queries || [])
    .filter(q => q.position >= 8 && q.position <= 20 && q.impressions >= minImpressions && String(q.query || '').split(/\s+/).length >= 2)
    .filter(q => { const n = norm(q.query); return !have.some(h => h === n || h.includes(n) || n.includes(h)); })
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, limit);
}

module.exports = { performance, compare, strikingDistance, period, query };
