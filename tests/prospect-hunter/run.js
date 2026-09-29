/**
 * Webese Prospect Hunter checks (Chase / Sales Intelligence, Phase 1).
 *
 * Covers the non-negotiable rule repeated everywhere else in this codebase:
 * never fabricate a result when real data is unavailable.
 *
 *   1. detectTechnology() finds Wix/GoDaddy from real signatures, and comes
 *      back {available:false} — never a fabricated empty result — when the
 *      site cannot be fetched at all.
 *   2. auditWebsite() returns scores.performance:null (not a guessed number,
 *      the exact class of bug this codebase already fixed once in
 *      seo-pulse.html) when PageSpeed is unavailable, while still computing
 *      the deterministic HTML checks and reporting their evidence.
 *   3. calculateOpportunityScore() hits its documented classification
 *      boundaries, and — the single most important behavioural property of
 *      the whole model — scores a good, established business with a weak
 *      website HIGHER than a struggling business with an equally weak site.
 *   4. The two new routes authenticate and rate-limit before doing any real
 *      work.
 *
 *   node tests/prospect-hunter/run.js
 */
'use strict';

const path = require('path');
const fs = require('fs');
const REPO = path.resolve(__dirname, '..', '..');

let failures = 0;
function check(label, ok) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failures++;
}
const read = f => fs.readFileSync(path.join(REPO, f), 'utf8');

/* ── Fake Supabase (requireUser's profile lookup) ──────────────────────── */
const helperPath = path.join(REPO, 'api/_lib/supabase-rest.js');
require.cache[helperPath] = {
  id: helperPath, filename: helperPath, loaded: true,
  exports: {
    sbRest: async (u, k, method, p) => {
      if (p.startsWith('/profiles')) {
        return { ok: true, status: 200, data: [{ id: 'user-1', plan: 'growth', role: 'user' }] };
      }
      return { ok: false, status: 404, data: null };
    },
  },
};

const { resetForTests: resetRateLimits } = require(path.join(REPO, 'api/_lib/rate-limit.js'));

function env() {
  process.env.SUPABASE_URL = 'https://x.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
}

/** A single-chunk ReadableStream, the shape safeFetchText reads from. */
function streamOf(text) {
  const bytes = Buffer.from(text, 'utf8');
  let sent = false;
  return {
    getReader: () => ({
      read: async () => (sent ? { done: true } : (sent = true, { done: false, value: bytes })),
      cancel: async () => {},
    }),
  };
}

/** Swap global.fetch for the duration of `fn`, always restoring it after. */
async function withFetch(fetchImpl, fn) {
  const real = global.fetch;
  global.fetch = fetchImpl;
  try { return await fn(); } finally { global.fetch = real; }
}

/** A fetch stub that answers `/auth/v1/user` and routes every other request
 *  through `pageHandler(url) -> {status, html} | null` (null = 404). */
function makeSiteFetch(pageHandler) {
  return async (url, opts) => {
    const u = String(url);
    if (u.includes('/auth/v1/user')) {
      return { ok: true, json: async () => ({ id: 'user-1' }) };
    }
    const page = pageHandler(u);
    if (!page) {
      return { status: 404, url: u, headers: new Headers(), body: streamOf('not found') };
    }
    const headers = new Headers(page.headers || {});
    if (!headers.has('content-type')) headers.set('content-type', 'text/html');
    return { status: page.status || 200, url: u, headers, body: streamOf(page.html || '') };
  };
}

(async () => {

/* ══════════════════════════════════════════════════════════════════════
   1. detectTechnology()
   ══════════════════════════════════════════════════════════════════════ */
console.log('\n──── detectTechnology() ────');
const { detectTechnology } = require(path.join(REPO, 'api/_lib/tech-detect.js'));

await withFetch(makeSiteFetch(u => {
  if (u === 'https://example.com/wix-fixture') {
    return { html: '<html><head><script>var wix_warmup_data={};</script></head><body><img src="https://static.wixstatic.com/media/foo.png"></body></html>' };
  }
  return null;
}), async () => {
  const result = await detectTechnology('https://example.com/wix-fixture');
  check('Wix fixture: available:true, checked:true', result.available === true && result.checked === true);
  const wix = result.technologies.find(t => t.name === 'Wix');
  check('Wix is detected', !!wix);
  check('Wix evidence names the actual matched string, not an invented one',
    !!wix && /static\.wixstatic\.com/.test(wix.evidence));
  check('Wix is categorized as a website-builder', !!wix && wix.category === 'website-builder');
});

await withFetch(makeSiteFetch(u => {
  if (u === 'https://example.com/godaddy-fixture') {
    return { html: '<html><head></head><body><a href="/websitebuilder/edit">Edit site</a><img src="https://img1.wsimg.com/logo.png"></body></html>' };
  }
  return null;
}), async () => {
  const result = await detectTechnology('https://example.com/godaddy-fixture');
  const godaddy = result.technologies.find(t => t.name === 'GoDaddy Website Builder');
  check('GoDaddy Website Builder is detected', !!godaddy);
  check('GoDaddy evidence is a real matched string',
    !!godaddy && /img1\.wsimg\.com/.test(godaddy.evidence));
});

// The site cannot be fetched at all (a blocked/internal hostname is enough
// to force this deterministically, with no dependence on the fetch stub).
{
  const result = await detectTechnology('http://localhost/');
  check('an unreachable site returns available:false, not a fabricated empty result',
    result.available === false);
  check('and says it was never actually checked',
    result.checked === false && Array.isArray(result.technologies) && result.technologies.length === 0);
  check('and gives an honest reason', typeof result.reason === 'string' && result.reason.length > 0);
}

/* ══════════════════════════════════════════════════════════════════════
   2. auditWebsite()
   ══════════════════════════════════════════════════════════════════════ */
console.log('\n──── auditWebsite() ────');
const { auditWebsite } = require(path.join(REPO, 'api/_lib/website-audit.js'));

const BROKEN_HOMEPAGE_HTML = `<html><head><title>Acme Home Services</title></head>
<body><p>We fix things. Call us today.</p></body></html>`;

await withFetch(makeSiteFetch(u => {
  if (u === 'https://example.com/') return { html: BROKEN_HOMEPAGE_HTML };
  return null; // every other candidate path 404s
}), async () => {
  // No pagespeedApiKey passed — PageSpeed must never be silently faked.
  const audit = await auditWebsite('https://example.com/');

  check('performance score is null when PageSpeed is unavailable — never a fabricated number',
    audit.scores.performance === null);
  check('the missing category is named in scores._partial, not silently dropped',
    Array.isArray(audit.scores._partial) && audit.scores._partial.includes('performance'));
  check('deterministic HTML scores were still computed from the real fetch',
    typeof audit.scores.seo === 'number' && typeof audit.scores.mobile === 'number');

  const issues = audit.problems.map(p => p.issue);
  check('missing viewport tag is reported', issues.includes('No mobile viewport tag'));
  check('missing H1 is reported', issues.includes('No H1 heading found'));
  check('missing meta description is reported', issues.includes('Missing meta description'));

  const viewportProblem = audit.problems.find(p => p.issue === 'No mobile viewport tag');
  check('each reported problem carries real evidence, not a vague claim',
    !!viewportProblem && typeof viewportProblem.evidence === 'string' && viewportProblem.evidence.length > 0);
});

/* ══════════════════════════════════════════════════════════════════════
   3. calculateOpportunityScore()
   ══════════════════════════════════════════════════════════════════════ */
console.log('\n──── calculateOpportunityScore() ────');
const { calculateOpportunityScore, industryValueTier } = require(path.join(REPO, 'api/_lib/opportunity-score.js'));

const boundary = (base) => calculateOpportunityScore({}, { BASE_SCORE: base }).classification;
check('score 90 -> exceptional', boundary(90) === 'exceptional');
check('score 89 -> high_priority', boundary(89) === 'high_priority');
check('score 70 -> strong_prospect', boundary(70) === 'strong_prospect');
check('score 69 -> potential_prospect', boundary(69) === 'potential_prospect');
check('score 50 -> low_priority', boundary(50) === 'low_priority');
check('score 49 -> do_not_contact', boundary(49) === 'do_not_contact');

// The property that matters most: a good, established business with a weak
// website beats a struggling business with an equally weak website.
const weakAudit = { performance: 20, mobile: 30, seo: 25, localSeo: 20, conversion: 15, content: 20 };
const weakProblems = [{ severity: 'high' }, { severity: 'high' }, { severity: 'medium' }];

const goodBusinessWeakSite = calculateOpportunityScore({
  platform: 'Wix', isTargetPlatform: true,
  auditScores: weakAudit, problems: weakProblems,
  googleRating: 4.8, googleReviewCount: 150,
  hasActiveSocial: true, industryValueTier: 'high', hasContactInfo: true,
});
const badBusinessWeakSite = calculateOpportunityScore({
  platform: 'Wix', isTargetPlatform: true,
  auditScores: weakAudit, problems: weakProblems,
  googleRating: null, googleReviewCount: 0,
  hasActiveSocial: false, industryValueTier: 'low', hasContactInfo: false,
});
check('a good business with a weak website scores higher than a bad business with the same weak website',
  goodBusinessWeakSite.score > badBusinessWeakSite.score);
check('the good-business breakdown actually cites its real rating/reviews/industry as reasons',
  goodBusinessWeakSite.breakdown.some(b => /4\.8/.test(b.reason)) &&
  goodBusinessWeakSite.breakdown.some(b => /150/.test(b.reason)));

// industryValueTier() never guesses.
check('a curated high-value industry maps correctly', industryValueTier('Roofing Contractor') === 'high');
check('a curated medium-value industry maps correctly', industryValueTier('Plumbing') === 'medium');
check('a curated low-value industry maps correctly', industryValueTier('Small Cafe') === 'low');
check('an unrecognized industry is null, never guessed', industryValueTier('underwater basket weaving') === null);
check('no industry given is null', industryValueTier(null) === null);

/* ══════════════════════════════════════════════════════════════════════
   4. The two new endpoints authenticate + rate-limit before real work
   ══════════════════════════════════════════════════════════════════════ */
console.log('\n──── the new endpoints know who is calling before they spend anything ────');

const ENDPOINTS = ['tech-detect', 'sales-audit-lead'];

for (const name of ENDPOINTS) {
  const src = read(`api/${name}.js`);
  check(`${name}: calls requireUser before rateLimited`,
    src.indexOf('await requireUser(req, res)') !== -1 &&
    src.indexOf('await requireUser(req, res)') < src.indexOf('rateLimited(req, res'));
  check(`${name}: is wrapped in withFailureReporting`, /withFailureReporting\(/.test(src));
  check(`${name}: sets CORS headers matching sibling endpoints`,
    /Access-Control-Allow-Origin/.test(src) && /Access-Control-Allow-Methods/.test(src));
}

async function callEndpoint(handler, body, opts) {
  env();
  opts = opts || {};
  let status = 200, payload = null;
  const res = {
    setHeader() {}, status(c) { status = c; return this; },
    json(o) { payload = o; return this; }, end() { return this; },
  };
  const headers = { host: 'app.test', 'x-forwarded-for': `10.2.0.${Math.floor(Math.random() * 250)}` };
  if (!opts.noAuth) headers.authorization = 'Bearer t';
  await handler({ method: 'POST', headers, query: {}, body: body || {} }, res);
  return { status, body: payload };
}

resetRateLimits();
let upstreamCalls = [];
await withFetch(async (url) => {
  const u = String(url);
  if (u.includes('/auth/v1/user')) return { ok: false, json: async () => ({}) }; // invalid token
  upstreamCalls.push(u);
  return { status: 200, url: u, headers: new Headers(), body: streamOf('') };
}, async () => {
  const techDetect = require(path.join(REPO, 'api/tech-detect.js'));
  const salesAudit = require(path.join(REPO, 'api/sales-audit-lead.js'));

  upstreamCalls = [];
  let r = await callEndpoint(techDetect, { url: 'https://example.com/' }, { noAuth: true });
  check('tech-detect refuses an unauthenticated call', r.status === 401);
  check('tech-detect reaches no external site when unauthenticated', upstreamCalls.length === 0);

  upstreamCalls = [];
  r = await callEndpoint(techDetect, { url: 'https://example.com/' }); // has a bearer token, but it's invalid
  check('tech-detect refuses an invalid token', r.status === 401);
  check('and spends nothing doing it', upstreamCalls.length === 0);

  upstreamCalls = [];
  r = await callEndpoint(salesAudit, { url: 'https://example.com/' }, { noAuth: true });
  check('sales-audit-lead refuses an unauthenticated call', r.status === 401);
  check('sales-audit-lead reaches no external site when unauthenticated', upstreamCalls.length === 0);
});

console.log('\n' + (failures === 0 ? 'ALL ASSERTIONS PASSED' : `${failures} FAILED`));
process.exit(failures === 0 ? 0 : 1);
})();
