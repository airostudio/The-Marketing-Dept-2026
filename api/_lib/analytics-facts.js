/**
 * api/_lib/analytics-facts.js — gather the numbers an analytics report may
 * quote, from the account's own records, and check a written report against
 * them.
 *
 * The rule this file exists to enforce: a report only contains figures the
 * account's data produced. So the facts are gathered by code (not by a
 * model), every source says plainly when it is unavailable or not recorded
 * (never a silent zero), and verifyNumbers() finds any figure in the written
 * text that is not in the facts — which blocks the report rather than
 * letting an invented statistic reach a reader.
 *
 * Scope: the calling user's own records. Campaign stats are keyed to the user
 * who sent them, so campaigns sent by a teammate are not included.
 */

'use strict';

const { readCampaignMetrics } = require('./campaign-metrics.js');

const DAY = 24 * 60 * 60 * 1000;
const MAX_CAMPAIGNS = 8;
const ROW_CAP = 20000;
const PERIODS = [7, 30, 90];

const pct = (cur, prev) => (prev > 0 ? Math.round(((cur - prev) / prev) * 1000) / 10 : null);
const dollars = (cents) => Math.round(Number(cents) || 0) / 100;
const fmtDate = (d) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

function unavailable(res, what) {
  return { available: false, reason: res.status === 404 ? `${what} is not installed on this account's database.` : `${what} could not be read (HTTP ${res.status}).` };
}

/**
 * @param {Function} sb  (method, path, body) => {ok,status,data}
 * @param {{supabaseUrl:string, serviceKey:string, userId:string, periodDays:number, now?:number}} o
 */
async function gatherFacts(sb, o) {
  const days = PERIODS.includes(o.periodDays) ? o.periodDays : 30;
  const now = o.now || Date.now();
  const end = new Date(now), start = new Date(now - days * DAY), prevStart = new Date(now - 2 * days * DAY);
  const iso = (d) => encodeURIComponent(d.toISOString());
  const uid = o.userId;
  const inPeriod = (t) => t && new Date(t) >= start && new Date(t) <= end;
  const inPrev = (t) => t && new Date(t) >= prevStart && new Date(t) < start;

  const facts = {
    period: { days, label: `${fmtDate(start)} – ${fmtDate(end)}`, previousLabel: `${fmtDate(prevStart)} – ${fmtDate(new Date(start - 1))}` },
    email: null, revenue: null, audience: null, flows: null, social: null, unavailable: [],
  };

  /* ── email ───────────────────────────────────────────────────────── */
  const sends = await sb('GET', `/campaign_sends?user_id=eq.${uid}&sent_at=gte.${iso(prevStart)}&select=campaign_id,campaign_name,subject,status,sent_at&order=sent_at.desc&limit=${ROW_CAP}`);
  if (!sends.ok) {
    facts.email = unavailable(sends, 'Email send history');
  } else {
    const rows = sends.data || [];
    const cur = rows.filter(r => inPeriod(r.sent_at)), prev = rows.filter(r => inPrev(r.sent_at));
    const byCamp = new Map();
    for (const r of cur) {
      if (!byCamp.has(r.campaign_id)) byCamp.set(r.campaign_id, { campaignId: r.campaign_id, name: r.campaign_name || r.subject || 'Untitled', subject: r.subject || null, firstSent: r.sent_at, recipients: 0, failed: 0 });
      const c = byCamp.get(r.campaign_id);
      if (r.status === 'sent') c.recipients++; else c.failed++;
      if (r.sent_at < c.firstSent) c.firstSent = r.sent_at;
    }
    const all = [...byCamp.values()].sort((a, b) => (a.firstSent < b.firstSent ? 1 : -1));
    const shown = all.slice(0, MAX_CAMPAIGNS);
    const totals = { counts: { sent: 0, delivered: 0, uniqueOpened: 0, uniqueClicked: 0, bounced: 0, complained: 0 }, anyOpenTracked: false, anyClickTracked: false };
    for (const c of shown) {
      const m = await readCampaignMetrics(o.supabaseUrl, o.serviceKey, c.campaignId, uid);
      if (m.ok) {
        c.engagement = { counts: m.stats.counts, rates: m.stats.rates, openTracking: m.stats.openTracking, clickTracking: m.stats.clickTracking, note: m.stats.notes || null };
        c.revenue = m.stats.revenue;
        for (const k of Object.keys(totals.counts)) totals.counts[k] += m.stats.counts[k] || 0;
        totals.anyOpenTracked = totals.anyOpenTracked || m.stats.openTracking === 'tracked';
        totals.anyClickTracked = totals.anyClickTracked || m.stats.clickTracking === 'tracked';
      } else {
        c.engagement = { available: false, reason: m.notInstalled ? 'Email event tracking is not installed, so opens and clicks cannot be reported.' : `Engagement could not be read (HTTP ${m.status}).` };
      }
      delete c.campaignId;
    }
    const base = totals.counts.delivered || totals.counts.sent;
    const r1 = (n, d) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);
    const emailsSent = cur.filter(r => r.status === 'sent').length;
    const prevSent = prev.filter(r => r.status === 'sent').length;
    facts.email = {
      available: true,
      campaignsSent: all.length, emailsSent, emailsFailedOrRejected: cur.length - emailsSent,
      previousPeriodEmailsSent: prevSent, emailsSentChangePct: pct(emailsSent, prevSent),
      campaignsShown: shown.length, campaigns: shown,
      // Combined across the campaigns shown. Rates stay null unless that
      // measure was actually recorded — "not tracked" is not "nobody".
      combined: {
        counts: totals.counts,
        openRatePct: totals.anyOpenTracked ? r1(totals.counts.uniqueOpened, base) : null,
        clickRatePct: totals.anyClickTracked ? r1(totals.counts.uniqueClicked, base) : null,
        bounceRatePct: r1(totals.counts.bounced, totals.counts.sent),
        complaintRatePct: r1(totals.counts.complained, totals.counts.sent),
        openTracking: totals.anyOpenTracked ? 'tracked' : 'not-recorded-or-no-events',
      },
      truncated: rows.length >= ROW_CAP || undefined,
    };
    if (!all.length) facts.email.note = 'No emails were sent in this period.';
  }

  /* ── revenue ─────────────────────────────────────────────────────── */
  const conv = await sb('GET', `/email_conversions?user_id=eq.${uid}&occurred_at=gte.${iso(start)}&select=amount_cents,currency,attribution&limit=${ROW_CAP}`);
  if (!conv.ok) {
    facts.revenue = unavailable(conv, 'Revenue tracking');
  } else {
    const rows = conv.data || [];
    const currencies = [...new Set(rows.map(r => r.currency))];
    if (!rows.length) {
      facts.revenue = { available: true, orders: 0, note: 'No orders were reported in this period. If your shop is not sending orders to Audema, this is blank, not zero revenue.' };
    } else if (currencies.length > 1) {
      facts.revenue = { available: true, orders: rows.length, note: `Orders were reported in more than one currency (${currencies.join(', ')}), so they are not added together.` };
    } else {
      const att = rows.filter(r => r.attribution !== 'none');
      facts.revenue = {
        available: true, orders: rows.length, currency: currencies[0],
        attributedToEmail: dollars(att.reduce((s, r) => s + Number(r.amount_cents), 0)), attributedOrders: att.length,
        notAttributed: dollars(rows.filter(r => r.attribution === 'none').reduce((s, r) => s + Number(r.amount_cents), 0)),
      };
    }
  }

  /* ── audience ────────────────────────────────────────────────────── */
  const contacts = await sb('GET', `/contacts?user_id=eq.${uid}&select=status,created_at,status_changed_at&limit=${ROW_CAP}`);
  if (!contacts.ok) {
    facts.audience = unavailable(contacts, 'The audience');
  } else {
    const rows = contacts.data || [];
    const byStatus = {};
    rows.forEach(c => { byStatus[c.status] = (byStatus[c.status] || 0) + 1; });
    const newCur = rows.filter(c => inPeriod(c.created_at)).length, newPrev = rows.filter(c => inPrev(c.created_at)).length;
    const left = (st) => rows.filter(c => c.status === st && inPeriod(c.status_changed_at)).length;
    facts.audience = {
      available: true, totalContacts: rows.length, byStatus,
      newContacts: newCur, previousPeriodNewContacts: newPrev, newContactsChangePct: pct(newCur, newPrev),
      unsubscribedInPeriod: left('unsubscribed'), bouncedInPeriod: left('bounced'), complainedInPeriod: left('complained'),
      truncated: rows.length >= ROW_CAP || undefined,
    };
  }

  /* ── flows ───────────────────────────────────────────────────────── */
  const flows = await sb('GET', `/email_flows?user_id=eq.${uid}&select=id,name,status&order=created_at.desc&limit=50`);
  if (!flows.ok) {
    facts.flows = unavailable(flows, 'Automation flows');
  } else {
    const list = [];
    for (const f of (flows.data || []).slice(0, 10)) {
      const e = await sb('GET', `/email_flow_enrolments?flow_id=eq.${f.id}&select=status`);
      const er = (e.ok && e.data) || [];
      list.push({ name: f.name, status: f.status, enrolled: er.length, inProgress: er.filter(x => x.status === 'active').length, completed: er.filter(x => x.status === 'completed').length, exited: er.filter(x => x.status === 'exited').length });
    }
    facts.flows = { available: true, count: (flows.data || []).length, flows: list };
  }

  /* ── social ──────────────────────────────────────────────────────── */
  const posts = await sb('GET', `/social_posts?user_id=eq.${uid}&source=eq.organic&created_at=gte.${iso(prevStart)}&select=status,platform,publish_status,published_at,created_at&limit=${ROW_CAP}`);
  if (!posts.ok) {
    facts.social = unavailable(posts, 'Social posts');
  } else {
    const rows = posts.data || [];
    const pubCur = rows.filter(p => p.publish_status === 'published' && inPeriod(p.published_at));
    const pubPrev = rows.filter(p => p.publish_status === 'published' && inPrev(p.published_at)).length;
    const byPlatform = {};
    pubCur.forEach(p => { byPlatform[p.platform] = (byPlatform[p.platform] || 0) + 1; });
    facts.social = {
      available: true,
      postsCreated: rows.filter(p => inPeriod(p.created_at)).length,
      published: pubCur.length, previousPeriodPublished: pubPrev, publishedChangePct: pct(pubCur.length, pubPrev),
      publishFailed: rows.filter(p => p.publish_status === 'failed' && inPeriod(p.created_at)).length,
      publishedByPlatform: byPlatform,
      waitingForReview: rows.filter(p => p.status === 'pending_review').length,
      approvedNotScheduled: rows.filter(p => p.status === 'approved').length,
      note: 'Likes, comments, reach and followers are not recorded by Audema, so this section counts what was posted, not how it performed.',
    };
  }

  ['email', 'revenue', 'audience', 'flows', 'social'].forEach(k => { if (facts[k] && facts[k].available === false) facts.unavailable.push(`${k}: ${facts[k].reason}`); });
  return facts;
}

/* ── checking a written report against its facts ─────────────────────── */

/** Every number the facts contain (including those inside text such as dates), as a Set of values. */
function factNumbers(facts) {
  const nums = new Set();
  const add = (n) => { if (Number.isFinite(n)) nums.add(Math.round(n * 1000) / 1000); };
  const fromString = (s) => { for (const m of String(s).matchAll(/\d+(?:\.\d+)?/g)) add(Number(m[0])); };
  (function walk(v) {
    if (v == null) return;
    if (typeof v === 'number') { add(v); add(Math.abs(v)); add(Math.round(v)); add(Math.round(v * 10) / 10); }
    else if (typeof v === 'string') fromString(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (typeof v === 'object') Object.values(v).forEach(walk);
  })(facts);
  return nums;
}

/**
 * Figures in `text` that are not in `facts`. A number counts as supported if
 * it equals a fact (to rounding). Markdown list numbering and whole numbers
 * up to 10 with no %, $ or decimals (the "3 campaigns" kind of count already
 * covered by the facts, and "top 3") are not checked.
 * @returns {string[]} the unsupported figures, as written
 */
function verifyNumbers(text, facts) {
  const known = factNumbers(facts);
  const body = String(text || '').split('\n').map(l => l.replace(/^\s*(?:[-*]\s+)?\d+[.)]\s+/, '')).join('\n');
  const bad = new Set();
  for (const m of body.matchAll(/([$£€])?(\d[\d,]*(?:\.\d+)?)(%)?/g)) {
    const raw = m[0];
    const val = Number(m[2].replace(/,/g, ''));
    if (!Number.isFinite(val)) continue;
    const small = Number.isInteger(val) && val <= 10 && !m[1] && !m[3];
    if (small) continue;
    const ok = [...known].some(k => Math.abs(k - val) < 0.051);
    if (!ok) bad.add(raw);
  }
  return [...bad];
}

module.exports = { gatherFacts, verifyNumbers, factNumbers, PERIODS, MAX_CAMPAIGNS };
