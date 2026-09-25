/**
 * api/_lib/safe-fetch.js — the one place that decides whether this server may
 * connect to an address a caller named.
 *
 * A large part of this product goes and looks at a website on the customer's
 * behalf: Nancy crawls a homepage, Blade checks a prospect's site, the SEO
 * tools read a competitor's page, the enrichment endpoints fetch a company's
 * domain, the competitor watcher runs unattended on a schedule. Every one of
 * those takes a URL from a request body and fetches it from inside our
 * infrastructure, which is an SSRF proxy unless the target is checked.
 *
 * Four endpoints had each grown their own copy of a hostname blocklist and
 * the copies had already drifted — api/check-url.js was missing 0.0.0.0 and
 * the cloud metadata address that api/fetch-page.js blocked — while three
 * other endpoints that fetch a caller-supplied URL had no check at all. This
 * suite covers the single implementation that replaced them.
 *
 * The three classes of bypass every inline copy shared:
 *
 *   1. Redirects. All of them validated the URL and then called fetch() with
 *      redirects followed automatically, so https://attacker/go → 302 →
 *      http://169.254.169.254/ passed the check and fetched the internal
 *      address anyway.
 *   2. Spellings. They matched hostname strings, and 127.0.0.1 can be written
 *      2130706433, 0x7f000001, or ::ffff:127.0.0.1.
 *   3. DNS. A hostname the attacker controls can simply resolve inward.
 *
 *   node tests/ssrf/run.js
 */
'use strict';

const path = require('path');
const fs = require('fs');

const REPO = path.resolve(__dirname, '..', '..');
const {
  validateTarget, safeFetch, safeFetchText,
  isBlockedIPv4, isBlockedIPv6, isBlockedAddress,
} = require(path.join(REPO, 'api/_lib/safe-fetch.js'));

let failures = 0;
function check(label, ok) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failures++;
}
/** Source with comment-only lines stripped, so a comment never satisfies a
 *  test that is asserting about code. */
function code(rel) {
  return fs.readFileSync(path.join(REPO, rel), 'utf8')
    .split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
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

(async () => {

/* ── 1. Address classification ──────────────────────────────────────────── */
console.log('\n──── which addresses are refused ────');

const v4 = [
  ['127.0.0.1',       true,  'loopback'],
  ['127.255.255.254', true,  'the rest of 127/8, not just .0.1'],
  ['10.1.2.3',        true,  'RFC1918 10/8'],
  ['192.168.0.1',     true,  'RFC1918 192.168/16'],
  ['172.16.0.1',      true,  'RFC1918 172.16/12 lower bound'],
  ['172.31.255.255',  true,  'RFC1918 172.16/12 upper bound'],
  ['172.32.0.1',      false, '172.32 is public and must stay reachable'],
  ['172.15.0.1',      false, '172.15 is public and must stay reachable'],
  ['169.254.169.254', true,  'the cloud metadata address'],
  ['169.254.0.1',     true,  'the whole of link-local, not just metadata'],
  ['100.64.0.1',      true,  'carrier-grade NAT'],
  ['0.0.0.0',         true,  '"this network"'],
  ['224.0.0.1',       true,  'multicast'],
  ['255.255.255.255', true,  'broadcast'],
  ['8.8.8.8',         false, 'a public resolver'],
  ['93.184.216.34',   false, 'a public web host'],
];
let mism = v4.filter(([ip, want]) => isBlockedIPv4(ip) !== want);
check('every IPv4 range classifies correctly', mism.length === 0);
if (mism.length) mism.forEach(([ip, want, why]) => console.log(`      ${ip} (${why}) — expected blocked=${want}`));

const v6 = [
  ['::1',              true,  'loopback'],
  ['::',               true,  'unspecified'],
  ['fc00::1',          true,  'unique local fc00::/7'],
  ['fd12:3456::1',     true,  'unique local, fd prefix'],
  ['fe80::1',          true,  'link-local'],
  ['ff02::1',          true,  'multicast'],
  ['::ffff:127.0.0.1', true,  'IPv4-mapped loopback — the hat trick'],
  ['::ffff:10.0.0.1',  true,  'IPv4-mapped RFC1918'],
  ['::ffff:8.8.8.8',   false, 'IPv4-mapped public address stays reachable'],
  ['2606:4700::1111',  false, 'a public v6 host'],
];
mism = v6.filter(([ip, want]) => isBlockedIPv6(ip) !== want);
check('every IPv6 range classifies correctly', mism.length === 0);
if (mism.length) mism.forEach(([ip, want, why]) => console.log(`      ${ip} (${why}) — expected blocked=${want}`));

check('a string that is not an address at all is refused, not allowed through',
  isBlockedAddress('example.com') === true && isBlockedAddress('') === true);

// One IPv6 address has many spellings, and WHATWG URL parsing rewrites what
// it is handed: new URL('http://[::ffff:127.0.0.1]/') produces the hostname
// [::ffff:7f00:1]. A first version of this module pattern-matched the dotted
// form only, so the hostname it actually received went unrecognised and
// loopback was allowed through. Every spelling must reach the same verdict.
const spellingPairs = [
  ['::ffff:127.0.0.1', '::ffff:7f00:1',  true,  'IPv4-mapped loopback, dotted vs hex'],
  ['::ffff:8.8.8.8',   '::ffff:808:808', false, 'IPv4-mapped public, dotted vs hex'],
  ['::ffff:10.0.0.1',  '::ffff:a00:1',   true,  'IPv4-mapped RFC1918, dotted vs hex'],
  ['fe80:0:0:0:0:0:0:1', 'fe80::1',      true,  'link-local, expanded vs elided'],
  ['2606:4700:0:0:0:0:0:1111', '2606:4700::1111', false, 'public, expanded vs elided'],
];
const spellingBad = spellingPairs.filter(([a, b, want]) =>
  isBlockedIPv6(a) !== want || isBlockedIPv6(b) !== want);
check('every spelling of an IPv6 address reaches the same verdict', spellingBad.length === 0);
spellingBad.forEach(([a, b, want, why]) =>
  console.log(`      ${why}: ${a}=${isBlockedIPv6(a)} ${b}=${isBlockedIPv6(b)}, expected ${want}`));

check('an unparseable IPv6 address is refused, not allowed',
  isBlockedIPv6('1:2:3') === true && isBlockedIPv6('::1::2') === true &&
  isBlockedIPv6('gggg::1') === true);

/* ── 2. Every spelling of an address ────────────────────────────────────── */
console.log('\n──── the same address written four ways ────');

const spellings = [
  'http://127.0.0.1/',
  'http://2130706433/',       // decimal
  'http://0x7f000001/',       // hex
  'http://[::ffff:127.0.0.1]/',
];
const results = await Promise.all(spellings.map(u => validateTarget(u)));
check('decimal, hex and IPv4-mapped forms are refused like the dotted one',
  results.every(r => r.ok === false));
results.forEach((r, i) => { if (r.ok) console.log(`      LEAKED: ${spellings[i]}`); });

check('a public address is still allowed',
  (await validateTarget('https://example.com/')).ok === true);

/* ── 3. Protocol and credentials ────────────────────────────────────────── */
console.log('\n──── only public http(s), with no credentials ────');

for (const [u, why] of [
  ['file:///etc/passwd',            'file:'],
  ['gopher://x/1',                  'gopher:'],
  ['ftp://example.com/x',           'ftp:'],
  ['data:text/html,<b>x</b>',       'data:'],
]) {
  const r = await validateTarget(u);
  check(`${why} is refused`, r.ok === false);
}
check('a URL carrying credentials is refused',
  (await validateTarget('http://user:pass@example.com/')).ok === false);
check('a malformed URL is refused rather than throwing',
  (await validateTarget('not a url')).ok === false);

/* ── 4. Internal names ──────────────────────────────────────────────────── */
console.log('\n──── names that only exist inside ────');

for (const h of ['localhost', 'metadata.google.internal', 'printer.local', 'db.internal']) {
  check(`${h} is refused`, (await validateTarget(`http://${h}/`)).ok === false);
}

/* ── 5. The redirect bypass ─────────────────────────────────────────────── */
console.log('\n──── a redirect cannot smuggle in an address the URL could not ────');

async function withFetch(stub, fn) {
  const real = global.fetch;
  global.fetch = stub;
  try { return await fn(); } finally { global.fetch = real; }
}

let requested = [];
let threw = null;
await withFetch(async (u) => {
  requested.push(String(u));
  if (String(u).startsWith('https://example.com/')) {
    return { status: 302, headers: new Map([['location', 'http://169.254.169.254/latest/meta-data/']]), body: null };
  }
  return { status: 200, url: String(u), headers: new Map(), body: streamOf('SECRET') };
}, async () => {
  try { await safeFetch('https://example.com/go'); } catch (e) { threw = e; }
});
check('a 302 to the metadata endpoint is refused at the hop', threw !== null);
check('and the internal address is never actually requested',
  !requested.some(u => u.includes('169.254')));
check('the error names the address that was refused',
  threw && /169\.254\.169\.254/.test(threw.message));

// A relative redirect must resolve against the URL we requested, not be
// treated as a hostname.
requested = []; threw = null;
let got = null;
await withFetch(async (u) => {
  requested.push(String(u));
  if (String(u) === 'https://example.com/a') {
    return { status: 301, headers: new Map([['location', '/b']]), body: null };
  }
  return { status: 200, url: String(u), headers: new Map(), body: streamOf('ok') };
}, async () => {
  try { got = await safeFetch('https://example.com/a'); } catch (e) { threw = e; }
});
check('a relative redirect on an allowed host is followed normally',
  threw === null && got && got.status === 200 &&
  requested.includes('https://example.com/b'));

// A redirect loop must end, not hang.
threw = null;
let hops = 0;
await withFetch(async (u) => {
  hops++;
  return { status: 302, headers: new Map([['location', 'https://example.com/loop']]), body: null };
}, async () => {
  try { await safeFetch('https://example.com/loop'); } catch (e) { threw = e; }
});
check('a redirect loop stops rather than hanging',
  threw !== null && /Too many redirects/.test(threw.message));
check('and it stops after a small bounded number of hops', hops <= 7);

/* ── 6. Bounded reads ───────────────────────────────────────────────────── */
console.log('\n──── a caller-named URL cannot hand us an unbounded body ────');

const huge = 'x'.repeat(50_000);
let out = null;
await withFetch(async (u) => ({
  status: 200, url: String(u), headers: new Map([['content-type', 'text/html']]), body: streamOf(huge),
}), async () => {
  out = await safeFetchText('https://example.com/big', { maxBytes: 1000 });
});
check('the body is cut at maxBytes', out && out.text.length === 1000);
check('and the caller is told it was cut rather than being handed a partial document silently',
  out && out.truncated === true);

/* ── 7. No endpoint keeps its own copy any more ─────────────────────────── */
console.log('\n──── one implementation, not five ────');

// The literal that appeared in all four drifted copies. If it comes back
// anywhere, a fifth copy is being grown.
const OLD_BLOCKLIST = /\/\^\(127\\\.\|10\\\.\|192\\\.168\\\./;
const suspects = [
  'api/fetch-page.js', 'api/check-url.js', 'api/blade-website-check.js',
  'api/_lib/nancy-crawl.js', 'api/crawl.js', 'api/enrich-business.js',
  'api/cron-competitor-watch.js', 'api/seo-backlink-find-email.js',
];
const stillInline = suspects.filter(f => OLD_BLOCKLIST.test(code(f)));
check('no endpoint carries its own private-range regex any more', stillInline.length === 0);
if (stillInline.length) console.log('      ', stillInline);

// Every one of them must route through the shared module.
const notWired = suspects.filter(f => !/require\(['"]\.[./]*(_lib\/)?safe-fetch\.js['"]\)/.test(code(f)));
check('every URL-fetching endpoint goes through safe-fetch', notWired.length === 0);
if (notWired.length) console.log('      ', notWired);

// And none of them still asks fetch() to follow redirects for it, which is
// what made the old checks bypassable.
const stillFollowing = suspects.filter(f => /redirect:\s*['"]follow['"]/.test(code(f)));
check('none of them still delegates redirect-following to fetch()',
  stillFollowing.length === 0);
if (stillFollowing.length) console.log('      ', stillFollowing);

check('safe-fetch itself follows redirects manually so it can re-check each one',
  /redirect:\s*['"]manual['"]/.test(code('api/_lib/safe-fetch.js')));

console.log(failures === 0 ? '\nALL ASSERTIONS PASSED\n' : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);

})();
