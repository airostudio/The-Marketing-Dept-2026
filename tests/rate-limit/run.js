/**
 * Rate limiting across 41 endpoints that spend the account's money.
 *
 * ── What was there ────────────────────────────────────────────────────────
 *
 * Each of those endpoints carried its own copy of the same twelve lines:
 *
 *     const rateBuckets = new Map();
 *     function getClientIp(req) { ...x-forwarded-for... }
 *     function checkRateLimit(ip) { ...count in the Map... }
 *
 * Two problems, one fixable and one not.
 *
 * The Map lives in a single serverless instance's memory. Vercel runs as many
 * instances as the traffic needs, so "15 per minute" is really "15 per minute
 * per warm instance", and instances multiply under load — the limit loosens
 * under exactly the pressure it exists to handle. That cannot be fixed by
 * writing the counter better; the counter is in the wrong place. The shared
 * module is therefore honest about being a burst guard, and the real ceilings
 * stay where they already are: consume_mission_usage(), consume_credits() and
 * claimQuota(), all database-backed and shared across instances.
 *
 * The fixable one: every copy keyed on an address. An address is the wrong
 * unit for metering an endpoint that spends an account's money — it charges a
 * shared office as one caller, and lets one account spread its spending over
 * as many addresses as it can reach. All 41 now key on the authenticated
 * account, which is derived from a verified token and cannot be varied by the
 * client.
 *
 * ── The bug this suite would have caught ──────────────────────────────────
 *
 * Nine endpoints ended up with the guard placed ABOVE the authentication that
 * produces the `auth` it reads. That is a ReferenceError on the first request,
 * and `node --check` cannot see it, because it is a scope error and not a
 * syntax error. The ordering check and the handler exercise below both catch
 * it.
 *
 *   node tests/rate-limit/run.js
 */
'use strict';

const path = require('path');
const fs = require('fs');

const REPO = path.resolve(__dirname, '..', '..');
const { rateLimit, rateLimited, clientIp } = require(path.join(REPO, 'api/_lib/rate-limit.js'));

let failures = 0;
function check(label, ok) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failures++;
}
function read(rel) { return fs.readFileSync(path.join(REPO, rel), 'utf8'); }
function code(rel) {
  return read(rel).replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n').filter(l => !/^\s*(\/\/|\*)/.test(l)).join('\n');
}
const req = h => ({ headers: h || {}, socket: { remoteAddress: '9.9.9.9' } });

/** Every endpoint using the shared limiter. */
const ENDPOINTS = fs.readdirSync(path.join(REPO, 'api'))
  .filter(f => f.endsWith('.js'))
  .filter(f => read(path.join('api', f)).includes('rateLimited(req, res'))
  .map(f => path.join('api', f));

/* ── 1. Which address is read ───────────────────────────────────────────── */
console.log('\n──── the address, when there is no account to key on ────');

check('x-real-ip is preferred — one value, set by the platform',
  clientIp(req({ 'x-real-ip': '5.5.5.5', 'x-forwarded-for': '1.2.3.4, 5.5.5.5' })) === '5.5.5.5');
check('x-forwarded-for is read from the LAST hop, not the first',
  clientIp(req({ 'x-forwarded-for': '1.2.3.4, 5.5.5.5' })) === '5.5.5.5');
check('a single-entry x-forwarded-for still works',
  clientIp(req({ 'x-forwarded-for': '5.5.5.5' })) === '5.5.5.5');
check('with no headers it falls back to the socket',
  clientIp(req()) === '9.9.9.9');
check('an empty header does not become the key',
  clientIp(req({ 'x-real-ip': '   ', 'x-forwarded-for': '' })) === '9.9.9.9');

/* ── 2. The account is the unit ─────────────────────────────────────────── */
console.log('\n──── the account is what gets metered, not the address ────');

const A = { userId: 'user-a' }, B = { userId: 'user-b' };
const opts = (name, max = 3) => ({ name, max, windowMs: 60_000 });

let last;
for (let i = 0; i < 4; i++) {
  last = rateLimit(req({ 'x-real-ip': `10.0.0.${i}` }), { ...opts('t1'), auth: A });
}
check('one account is limited even while varying its address',
  last.allowed === false);
check('and is told how long to wait',
  last.retryAfterSec > 0 && last.retryAfterSec <= 60);

check('a different account sharing that address is unaffected',
  rateLimit(req({ 'x-real-ip': '10.0.0.0' }), { ...opts('t1'), auth: B }).allowed === true);

check('a different endpoint has its own bucket',
  rateLimit(req({ 'x-real-ip': '10.0.0.0' }), { ...opts('t2'), auth: A }).allowed === true);

// With no account, the address is the fallback — and must still work.
let ipLast;
for (let i = 0; i < 4; i++) ipLast = rateLimit(req({ 'x-real-ip': '7.7.7.7' }), opts('t3'));
check('with no caller, the address is still limited', ipLast.allowed === false);
check('and a different address is not',
  rateLimit(req({ 'x-real-ip': '8.8.8.8' }), opts('t3')).allowed === true);

/* ── 3. The window reopens ──────────────────────────────────────────────── */
console.log('\n──── the window is a window, not a ban ────');

let shortLast;
for (let i = 0; i < 3; i++) shortLast = rateLimit(req(), { name: 't4', max: 2, windowMs: 40, auth: A });
check('the limit bites inside the window', shortLast.allowed === false);
const waited = Date.now() + 60;
while (Date.now() < waited) { /* a 40ms window has to actually elapse */ }
check('and reopens once the window has passed',
  rateLimit(req(), { name: 't4', max: 2, windowMs: 40, auth: A }).allowed === true);

/* ── 4. The 429 says what to do ─────────────────────────────────────────── */
console.log('\n──── a refusal a client can act on ────');

let sent = null, headers = {};
const res = {
  setHeader(k, v) { headers[k] = v; }, status(c) { sent = { code: c }; return this; },
  json(o) { if (sent) sent.body = o; return this; },
};
for (let i = 0; i < 3; i++) { sent = null; headers = {}; rateLimited(req(), res, { name: 't5', max: 2, windowMs: 60_000, auth: A }); }
check('the refusal is a 429', sent && sent.code === 429);
check('it sets Retry-After, which the inline versions never did',
  Number(headers['Retry-After']) > 0);
check('and repeats the figure in the body so a fetch client can read it',
  sent.body && sent.body.retryAfterSeconds > 0 && sent.body.code === 'rate_limited');

check('an allowed request sends nothing and reports false',
  rateLimited(req(), res, { name: 't6', max: 5, windowMs: 60_000, auth: B }) === false);

/* ── 5. No endpoint keeps its own copy ──────────────────────────────────── */
console.log('\n──── one limiter, not forty-one ────');

console.log(`  (${ENDPOINTS.length} endpoints use the shared limiter)`);
check('there are still the endpoints we expect to find', ENDPOINTS.length >= 40);

const inline = ENDPOINTS.filter(f => /\b(checkRateLimit|isRateLimited|rateBuckets)\b/.test(code(f)));
check('none defines its own bucket any more', inline.length === 0);
if (inline.length) console.log('      ', inline);

const unimported = ENDPOINTS.filter(f => !/require\('\.\/_lib\/rate-limit\.js'\)/.test(code(f)));
check('every one imports the shared module', unimported.length === 0);
if (unimported.length) console.log('      ', unimported);

/* ── 6. The guard is keyed, and reachable ───────────────────────────────── */
console.log('\n──── keyed on the account, and after the account exists ────');

/* app-config is deliberately public: it carries the Supabase probe, which
   exists to be reachable when authentication is the broken thing. There is no
   account to key on there, so the address is the only key available, and the
   limit is correspondingly tight. Everything else must key on the account. */
const PUBLIC_BY_DESIGN = new Set(['api/app-config.js']);

const addressKeyed = ENDPOINTS.filter(f =>
  !PUBLIC_BY_DESIGN.has(f) &&
  (code(f).match(/rateLimited\(req, res, \{[^}]*\}/g) || []).some(c => !/auth/.test(c)));
check('no limiter falls back to the address on an authenticated endpoint',
  addressKeyed.length === 0);
if (addressKeyed.length) console.log('      ', addressKeyed);

// The ReferenceError this suite exists for: `auth` read before it is declared.
//
// Checked per call site, not by comparing the first index of each. Two
// endpoints branch — failures.js and diagnostics.js each authenticate a
// reporting path with requireUser and a later admin path with requireAdmin —
// and a first-index comparison reports those as misordered when both branches
// are in fact correct. What has to hold is narrower and truer: before every
// individual rateLimited() call, some authentication has already run.
const AUTH_CALLS = [
  'await requireUser(req, res)',
  'await requireAdmin(req, res)',
  'await authenticateSender(req)',
  'await requireInternalToolsAccess(req, res)', // wraps requireUser() plus the tool's own unlock-token check
];
const misordered = ENDPOINTS.filter(f => {
  if (PUBLIC_BY_DESIGN.has(f)) return false;   // no auth to come after
  const s = code(f);
  const authAt = AUTH_CALLS
    .flatMap(call => {
      const out = []; let i = s.indexOf(call);
      while (i !== -1) { out.push(i); i = s.indexOf(call, i + 1); }
      return out;
    })
    .sort((a, b) => a - b);
  if (!authAt.length) return true;
  // Every guard must have an auth call somewhere above it.
  let i = s.indexOf('rateLimited(req, res');
  while (i !== -1) {
    if (!authAt.some(a => a < i)) return true;
    i = s.indexOf('rateLimited(req, res', i + 1);
  }
  return false;
});
check('every guard runs after the authentication that produces its key',
  misordered.length === 0);
if (misordered.length) console.log('      ', misordered);

/* ── 7. Each handler actually runs ──────────────────────────────────────── */
console.log('\n──── each handler survives a real unauthenticated call ────');

const realFetch = global.fetch;
global.fetch = async () => { throw new Error('network blocked in test'); };
const problems = [];
(async () => {
  for (const f of ENDPOINTS) {
    let handler;
    try { handler = require(path.join(REPO, f)); }
    catch (e) { problems.push(`${f}: load — ${e.message}`); continue; }
    let status = null;
    const r = {
      setHeader() {}, status(c) { status = c; return this; },
      json() { return this; }, end() { return this; }, redirect() { return this; },
    };
    try {
      await handler({ method: 'POST', headers: {}, body: {}, query: {}, socket: { remoteAddress: '1.2.3.4' } }, r);
      if (status === null) problems.push(`${f}: answered nothing`);
    } catch (e) {
      problems.push(`${f}: ${e.name} — ${e.message.slice(0, 90)}`);
    }
  }
  global.fetch = realFetch;

  check(`all ${ENDPOINTS.length} handlers answer without throwing`, problems.length === 0);
  problems.forEach(p => console.log('      ' + p));

  console.log(failures === 0 ? '\nALL ASSERTIONS PASSED\n' : `\n${failures} FAILED\n`);
  process.exit(failures === 0 ? 0 : 1);
})();
