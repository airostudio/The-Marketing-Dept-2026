/**
 * api/_lib/scorecard.js — the rules for scorecards and waitlists: what a
 * valid definition is, how a set of answers is scored, which tags a
 * respondent gets, and how responses add up into results. Pure functions; the
 * endpoints (api/scorecards.js, api/scorecard-public.js) do the I/O.
 *
 * A scorecard asks a visitor a series of questions, scores them and shows a
 * personal result (Daniel Priestley's ScoreApp model). A waitlist asks
 * questions without scoring, to learn what people need and what they would
 * pay, and lets two or more ideas be compared by real sign-ups.
 *
 * The score is always computed here, on the server, from the answers — never
 * taken from the browser.
 */

'use strict';

const crypto = require('crypto');

const KINDS = ['scorecard', 'waitlist'];
const TYPES = ['single', 'multi', 'scale', 'text'];
const SOURCES = ['email', 'instagram', 'facebook', 'linkedin', 'x', 'tiktok', 'youtube', 'ads', 'website', 'qr', 'other'];
const MAX_QUESTIONS = 20;
const MAX_OPTIONS = 8;
const MAX_BANDS = 5;
const MAX_TEXT_ANSWER = 500;
const SCALE_MIN = 0, SCALE_MAX = 10;

const str = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
const httpsUrl = (v) => { try { const u = new URL(String(v || '').trim()); return u.protocol === 'https:' ? u.href : ''; } catch { return ''; } };

/** A URL-safe slug: lowercase letters, numbers and single hyphens, 3-60 characters. */
function slugify(s) {
  return String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/g, '');
}
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,58}[a-z0-9])$/;

/** A tag-safe fragment, so tags read like `scorecard:website-health`. */
const tagPart = (s) => slugify(s).slice(0, 40) || 'x';

/**
 * Tidy a definition and list everything that would stop it being published.
 * @returns {{ def: object, problems: string[] }}
 */
function normalize(input) {
  const src = (input && typeof input === 'object') ? input : {};
  const kind = KINDS.includes(src.kind) ? src.kind : 'scorecard';
  const problems = [];

  const intro = src.intro || {};
  const def = {
    kind,
    title: str(src.title, 120),
    intro: {
      headline: str(intro.headline, 160),
      subheading: str(intro.subheading, 400),
      bullets: (Array.isArray(intro.bullets) ? intro.bullets : []).map(b => str(b, 160)).filter(Boolean).slice(0, 4),
      ctaLabel: str(intro.ctaLabel, 40) || (kind === 'waitlist' ? 'Join the waitlist' : 'Start the scorecard'),
    },
    questions: [],
    bands: [],
    resultCta: null,
    businessName: str(src.businessName, 120),
    privacyUrl: httpsUrl(src.privacyUrl),
    consentLabel: str(src.consentLabel, 300),
    group: str(src.group, 60),
    waitlistMessage: str(src.waitlistMessage, 600),
  };

  const qs = Array.isArray(src.questions) ? src.questions.slice(0, MAX_QUESTIONS) : [];
  const seen = new Set();
  qs.forEach((q, i) => {
    if (!q || typeof q !== 'object') return;
    const type = TYPES.includes(q.type) ? q.type : 'single';
    let id = slugify(q.id) || `q${i + 1}`;
    while (seen.has(id)) id = `${id}-${i + 1}`;
    seen.add(id);
    const out = { id, prompt: str(q.prompt, 300), help: str(q.help, 300), type, category: str(q.category, 60), required: q.required !== false };
    if (type === 'single' || type === 'multi') {
      const optSeen = new Set();
      out.options = (Array.isArray(q.options) ? q.options : []).slice(0, MAX_OPTIONS).map((o, n) => {
        let oid = slugify(o && o.id) || `o${n + 1}`;
        while (optSeen.has(oid)) oid = `${oid}-${n + 1}`;
        optSeen.add(oid);
        const pts = Number(o && o.points);
        return { id: oid, label: str(o && o.label, 160), points: kind === 'scorecard' && Number.isFinite(pts) ? Math.max(-100, Math.min(100, Math.round(pts))) : 0 };
      }).filter(o => o.label);
      if (out.options.length < 2) problems.push(`Question ${i + 1} needs at least two answers to choose from.`);
    }
    if (type === 'scale') {
      const min = Number.isFinite(Number(q.min)) ? Math.max(SCALE_MIN, Math.min(SCALE_MAX - 1, Math.round(Number(q.min)))) : 1;
      const max = Number.isFinite(Number(q.max)) ? Math.max(min + 1, Math.min(SCALE_MAX, Math.round(Number(q.max)))) : 5;
      Object.assign(out, { min, max, minLabel: str(q.minLabel, 60), maxLabel: str(q.maxLabel, 60) });
    }
    if (!out.prompt) problems.push(`Question ${i + 1} has no question text.`);
    def.questions.push(out);
  });

  if (!def.title) problems.push('Give it a title.');
  if (!def.intro.headline) problems.push('Add a headline for the landing page.');
  if (!def.questions.length) problems.push('Add at least one question.');
  if (!def.businessName) problems.push('Add the business name, so visitors know who they are giving their details to.');

  if (kind === 'scorecard') {
    if (!def.questions.some(q => scoredMax(q) > 0)) problems.push('A scorecard needs at least one question that scores points.');
    const bands = (Array.isArray(src.bands) ? src.bands : []).slice(0, MAX_BANDS).map((b, n) => ({
      key: tagPart(b && (b.key || b.title)) || `band-${n + 1}`,
      min: Math.max(0, Math.min(100, Math.round(Number(b && b.min) || 0))),
      max: Math.max(0, Math.min(100, Math.round(Number(b && b.max) || 0))),
      title: str(b && b.title, 120),
      message: String(b && b.message || '').replace(/\r\n?/g, '\n').trim().slice(0, 1500),
      nextStep: str(b && b.nextStep, 300),
    })).filter(b => b.title).sort((a, b) => a.min - b.min);
    def.bands = bands;
    if (!bands.length) problems.push('Add at least one result band (e.g. 0-40%, 41-70%, 71-100%).');
    else {
      // Every percentage from 0 to 100 must land in exactly one band.
      let expect = 0;
      for (const b of bands) {
        if (b.max < b.min) { problems.push(`The "${b.title}" band ends before it starts.`); break; }
        if (b.min !== expect) { problems.push(b.min > expect ? `No result band covers ${expect}%–${b.min - 1}%.` : `Result bands overlap at ${b.min}%.`); break; }
        expect = b.max + 1;
      }
      if (!problems.some(p => /band/.test(p)) && expect !== 101) problems.push(`No result band covers ${expect}%–100%.`);
    }
    const rc = src.resultCta || {};
    if (rc.label || rc.url) {
      const url = httpsUrl(rc.url);
      if (!url) problems.push('The result button link must be a full https:// address.');
      def.resultCta = { label: str(rc.label, 60) || 'Book a call', url };
    }
  }
  return { def, problems };
}

/** The most points a question can give. */
function scoredMax(q) {
  if (q.type === 'single') return Math.max(0, ...q.options.map(o => o.points));
  if (q.type === 'multi') return q.options.reduce((s, o) => s + Math.max(0, o.points), 0);
  if (q.type === 'scale') return q.max;
  return 0;
}

/**
 * Check a visitor's answers against the definition and score them.
 * @returns {{ ok: boolean, problems: string[], answers: object, score: number, maxScore: number, percent: number|null, band: object|null, categories: object }}
 */
function scoreAnswers(def, raw) {
  const given = (raw && typeof raw === 'object') ? raw : {};
  const answers = {}; const problems = [];
  let score = 0, maxScore = 0;
  const categories = {};
  for (const q of def.questions) {
    const a = given[q.id];
    let got = 0, empty = false;
    if (q.type === 'single') {
      const opt = q.options.find(o => o.id === a);
      if (opt) { answers[q.id] = opt.id; got = opt.points; } else empty = true;
    } else if (q.type === 'multi') {
      const ids = [...new Set((Array.isArray(a) ? a : []).map(String))].filter(id => q.options.some(o => o.id === id));
      if (ids.length) { answers[q.id] = ids; got = ids.reduce((s, id) => s + q.options.find(o => o.id === id).points, 0); } else empty = true;
    } else if (q.type === 'scale') {
      const n = Number(a);
      if (Number.isInteger(n) && n >= q.min && n <= q.max) { answers[q.id] = n; got = n; } else empty = true;
    } else {
      const t = String(a == null ? '' : a).replace(/\r\n?/g, '\n').trim().slice(0, MAX_TEXT_ANSWER);
      if (t) answers[q.id] = t; else empty = true;
    }
    if (empty && q.required) problems.push(`Please answer: ${q.prompt}`);
    if (def.kind === 'scorecard') {
      const m = scoredMax(q);
      score += got; maxScore += m;
      if (q.category && m > 0) {
        const c = categories[q.category] || (categories[q.category] = { score: 0, max: 0 });
        c.score += got; c.max += m;
      }
    }
  }
  let percent = null, band = null;
  if (def.kind === 'scorecard' && maxScore > 0) {
    percent = Math.max(0, Math.min(100, Math.round((Math.max(0, score) / maxScore) * 100)));
    band = def.bands.find(b => percent >= b.min && percent <= b.max) || null;
    for (const c of Object.values(categories)) c.percent = c.max ? Math.max(0, Math.min(100, Math.round((Math.max(0, c.score) / c.max) * 100))) : null;
  }
  return { ok: !problems.length, problems, answers, score, maxScore, percent, band, categories };
}

/** Tags for the contact: which scorecard, which result, and the choices they made. */
function tagsFor(slug, def, scored) {
  const tags = [`scorecard:${tagPart(slug)}`];
  if (scored.band) tags.push(`scorecard:${tagPart(slug)}:${scored.band.key}`);
  for (const q of def.questions) {
    if (q.type !== 'single') continue;
    const a = scored.answers[q.id];
    if (a) tags.push(`scorecard:${tagPart(slug)}:${q.id}-${a}`);
  }
  return tags.slice(0, 30);
}

const cleanSource = (v) => (SOURCES.includes(String(v || '').toLowerCase()) ? String(v).toLowerCase() : (v ? 'other' : null));

/**
 * Totals over a scorecard's responses — counts only, nothing estimated.
 * @param {object} def
 * @param {Array<{answers, percent, band_key, source, campaign, consented, created_at, email}>} rows
 */
function summarize(def, rows) {
  const out = {
    responses: rows.length,
    people: new Set(rows.map(r => String(r.email || '').toLowerCase()).filter(Boolean)).size,
    consented: rows.filter(r => r.consented).length,
    averagePercent: null, bands: {}, sources: {}, campaigns: {}, questions: [],
  };
  const pcts = rows.map(r => r.percent).filter(p => Number.isFinite(p));
  if (pcts.length) out.averagePercent = Math.round(pcts.reduce((s, p) => s + p, 0) / pcts.length);
  for (const b of def.bands || []) out.bands[b.key] = { title: b.title, count: 0 };
  for (const r of rows) {
    if (r.band_key && out.bands[r.band_key]) out.bands[r.band_key].count++;
    const s = r.source || 'direct'; out.sources[s] = (out.sources[s] || 0) + 1;
    if (r.campaign) out.campaigns[r.campaign] = (out.campaigns[r.campaign] || 0) + 1;
  }
  for (const q of def.questions) {
    const answered = rows.filter(r => r.answers && r.answers[q.id] != null);
    const entry = { id: q.id, prompt: q.prompt, type: q.type, answered: answered.length };
    if (q.type === 'single' || q.type === 'multi') {
      entry.options = q.options.map(o => ({ id: o.id, label: o.label, count: answered.filter(r => q.type === 'multi' ? (r.answers[q.id] || []).includes(o.id) : r.answers[q.id] === o.id).length }));
    } else if (q.type === 'scale') {
      const vals = answered.map(r => Number(r.answers[q.id])).filter(Number.isFinite);
      entry.average = vals.length ? Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 10) / 10 : null;
      entry.min = q.min; entry.max = q.max;
      entry.distribution = Array.from({ length: q.max - q.min + 1 }, (_, n) => ({ value: q.min + n, count: vals.filter(v => v === q.min + n).length }));
    } else {
      entry.recent = answered.slice(0, 20).map(r => String(r.answers[q.id]).slice(0, MAX_TEXT_ANSWER));
    }
    out.questions.push(entry);
  }
  return out;
}

/* ── a signed start token: proves the page was loaded a little while before submitting ── */
function secret() { return process.env.SCORECARD_SECRET || process.env.UNSUBSCRIBE_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || ''; }
function signStart(slug, at = Date.now()) {
  const mac = crypto.createHmac('sha256', secret()).update(`${slug}.${at}`).digest('base64url').slice(0, 32);
  return `${at}.${mac}`;
}
const MIN_FILL_MS = 3000;
const MAX_TOKEN_AGE_MS = 24 * 60 * 60 * 1000;
/** '' when fine, otherwise why the submission is refused. */
function checkStart(slug, token, now = Date.now()) {
  if (!secret()) return 'Submissions are not configured on this server.';
  const [atStr, mac] = String(token || '').split('.');
  const at = Number(atStr);
  if (!at || !mac) return 'Please reload the page and try again.';
  const want = crypto.createHmac('sha256', secret()).update(`${slug}.${at}`).digest('base64url').slice(0, 32);
  if (want.length !== mac.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(mac))) return 'Please reload the page and try again.';
  if (now - at < MIN_FILL_MS) return 'That was quicker than a person can answer. Please try again.';
  if (now - at > MAX_TOKEN_AGE_MS) return 'This page has been open a long time. Please reload it and try again.';
  return '';
}

const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

module.exports = {
  normalize, scoreAnswers, scoredMax, tagsFor, summarize, slugify, tagPart, cleanSource,
  signStart, checkStart, SLUG_RE, EMAIL_RE, KINDS, TYPES, SOURCES, MAX_QUESTIONS, MAX_TEXT_ANSWER, MIN_FILL_MS,
};
