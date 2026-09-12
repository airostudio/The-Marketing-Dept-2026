/**
 * api/_lib/safe-fetch.js — the one place that decides whether this server is
 * allowed to make a request to an address a customer named.
 *
 * Not a Vercel route; api/_lib/ is excluded from routing.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 *
 * A large part of this product's job is to go and look at a website: Nancy
 * crawls a homepage, Blade checks a prospect's site, the SEO tools fetch a
 * competitor's page, the enrichment endpoints read a company's domain. Every
 * one of those takes a URL from a request body and fetches it server-side.
 * That is, by construction, a request made from inside our infrastructure to
 * wherever the caller points it.
 *
 * Four endpoints had grown their own copy of a hostname blocklist. They had
 * already drifted apart — api/check-url.js was missing 0.0.0.0 and the cloud
 * metadata address that api/fetch-page.js blocked — and three other endpoints
 * that fetch a caller-supplied URL had no check at all. Duplicated security
 * logic decays; this module exists so there is one copy to get right.
 *
 * ── What the inline copies all missed ──────────────────────────────────────
 *
 * Every one of them validated the URL and then called fetch() with redirects
 * followed automatically. A blocked address does not have to be in the URL:
 *
 *     https://attacker.example/go   →  302  →  http://169.254.169.254/latest/
 *
 * The check passes, fetch follows the redirect, and the response comes back
 * with whatever the internal address returned. Redirects are followed here
 * one hop at a time with the destination re-validated at each hop.
 *
 * They also matched on the hostname string, which is only one of the ways to
 * write an address. http://2130706433/ and http://0x7f.1/ are both 127.0.0.1,
 * and a hostname the attacker controls can simply resolve to a private
 * address. Hostnames are resolved here and every returned address is checked,
 * which covers all three.
 *
 * ── What it deliberately does not claim ────────────────────────────────────
 *
 * This does not stop a determined DNS-rebinding attack. Node's fetch gives no
 * way to pin the connection to the address that was validated, so a name that
 * answers with a public address during the check and a private one a few
 * milliseconds later during the connection would still get through. Closing
 * that needs a custom agent with a connect-time hook. What is here removes
 * every bypass that does not require the attacker to also control an
 * authoritative nameserver and win a race.
 */

'use strict';

const dns = require('dns').promises;
const net = require('net');

/** Hard ceiling on redirect hops, so a redirect loop is not a hang. */
const MAX_REDIRECTS = 5;

/** Default per-request timeout. */
const DEFAULT_TIMEOUT_MS = 12000;

/** Default cap on how much of a response body will be read into memory. */
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;

/**
 * Is this IPv4 address one we refuse to connect to?
 *
 * Covers loopback and the RFC1918 ranges, and also the ones the inline
 * blocklists missed: the whole of 169.254/16 rather than the single metadata
 * address, carrier-grade NAT, the documentation and benchmark ranges, and
 * multicast/reserved space.
 */
function isBlockedIPv4(ip) {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = p;

  if (a === 0) return true;                                  // 0.0.0.0/8 "this network"
  if (a === 10) return true;                                 // RFC1918
  if (a === 127) return true;                                // loopback
  if (a === 169 && b === 254) return true;                   // link-local, incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;          // RFC1918
  if (a === 192 && b === 168) return true;                   // RFC1918
  if (a === 100 && b >= 64 && b <= 127) return true;         // RFC6598 carrier-grade NAT
  if (a === 192 && b === 0) return true;                     // 192.0.0/24 + 192.0.2/24 (TEST-NET-1)
  if (a === 198 && (b === 18 || b === 19)) return true;       // RFC2544 benchmark
  if (a === 198 && b === 51) return true;                    // TEST-NET-2
  if (a === 203 && b === 0) return true;                     // TEST-NET-3
  if (a >= 224) return true;                                 // multicast + reserved + broadcast
  return false;
}

/**
 * Expand an IPv6 address to its eight 16-bit groups.
 *
 * Comparing IPv6 as a string does not work, because one address has many
 * spellings: "::" elides a run of zero groups anywhere in the address, groups
 * drop leading zeros, and the last 32 bits may be written in dotted-quad form.
 * Worse, WHATWG URL parsing rewrites what it is given — new URL() turns
 * http://[::ffff:127.0.0.1]/ into the hostname [::ffff:7f00:1], so a check
 * that pattern-matched the dotted form saw an address it did not recognise
 * and allowed loopback straight through. Everything is normalised to numbers
 * here so there is one form to reason about.
 *
 * @returns {number[]|null} eight group values, or null if unparseable.
 */
function expandIPv6(ip) {
  let s = ip.toLowerCase().split('%')[0];      // drop any zone index

  // A trailing dotted quad is the low 32 bits: rewrite it as two groups.
  const quad = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (quad) {
    const o = quad[1].split('.').map(Number);
    if (o.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    s = s.slice(0, -quad[1].length) +
        ((o[0] << 8) | o[1]).toString(16) + ':' + ((o[2] << 8) | o[3]).toString(16);
  }

  const halves = s.split('::');
  if (halves.length > 2) return null;

  const parse = part => (part ? part.split(':').filter(x => x !== '') : []);
  const head = parse(halves[0]);
  const tail = halves.length === 2 ? parse(halves[1]) : [];

  let groups;
  if (halves.length === 2) {
    const fill = 8 - head.length - tail.length;
    if (fill < 0) return null;
    groups = [...head, ...Array(fill).fill('0'), ...tail];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;

  const nums = groups.map(g => parseInt(g, 16));
  if (nums.some(n => !Number.isInteger(n) || n < 0 || n > 0xffff)) return null;
  return nums;
}

/** Is this IPv6 address one we refuse to connect to? */
function isBlockedIPv6(ip) {
  const g = expandIPv6(ip);
  if (!g) return true;   // unparseable is refused, not allowed

  const allZeroUpTo = n => g.slice(0, n).every(x => x === 0);

  if (allZeroUpTo(8)) return true;                            // :: unspecified
  if (allZeroUpTo(7) && g[7] === 1) return true;              // ::1 loopback

  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d) are an IPv4
  // address wearing a hat — check the address inside, whichever way it was
  // spelled.
  if (allZeroUpTo(5) && g[5] === 0xffff) {
    return isBlockedIPv4(`${g[6] >> 8}.${g[6] & 0xff}.${g[7] >> 8}.${g[7] & 0xff}`);
  }
  if (allZeroUpTo(6)) {
    return isBlockedIPv4(`${g[6] >> 8}.${g[6] & 0xff}.${g[7] >> 8}.${g[7] & 0xff}`);
  }

  const first = g[0];
  if ((first & 0xfe00) === 0xfc00) return true;               // fc00::/7 unique local
  if ((first & 0xffc0) === 0xfe80) return true;               // fe80::/10 link-local
  if ((first & 0xff00) === 0xff00) return true;               // ff00::/8 multicast
  return false;
}

/** True when this literal IP address must not be connected to. */
function isBlockedAddress(ip) {
  const v = net.isIP(ip);
  if (v === 4) return isBlockedIPv4(ip);
  if (v === 6) return isBlockedIPv6(ip);
  return true;   // not an IP at all — caller should have resolved it first
}

/**
 * Resolve a hostname and refuse it if ANY address it answers with is blocked.
 *
 * Checking every answer rather than the first matters: a name can return one
 * public and one private address, and which one the connection actually uses
 * is not ours to choose.
 */
async function hostnameResolvesSafely(hostname) {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');

  // Names that never make sense as an external target.
  if (h === 'localhost' || h.endsWith('.localhost') ||
      h.endsWith('.local') || h.endsWith('.internal') ||
      h.endsWith('.home.arpa') || h === 'metadata.google.internal') {
    return { ok: false, reason: 'internal hostname' };
  }

  // A literal address needs no lookup. This also catches the numeric forms
  // (http://2130706433/) that a string blocklist never matches, because
  // getaddrinfo normalises them below.
  if (net.isIP(h)) {
    return isBlockedAddress(h)
      ? { ok: false, reason: 'private or reserved address' }
      : { ok: true };
  }

  let addresses;
  try {
    addresses = await dns.lookup(h, { all: true, verbatim: true });
  } catch {
    // A name that will not resolve cannot be fetched anyway. Refusing here
    // gives a clearer message than a socket error later.
    return { ok: false, reason: 'hostname does not resolve' };
  }
  if (!addresses.length) return { ok: false, reason: 'hostname does not resolve' };

  for (const { address } of addresses) {
    if (isBlockedAddress(address)) {
      return { ok: false, reason: 'hostname resolves to a private or reserved address' };
    }
  }
  return { ok: true };
}

/**
 * Validate one URL as a fetch target.
 *
 * @returns {Promise<{ok: true, url: URL} | {ok: false, reason: string}>}
 */
async function validateTarget(raw) {
  let url;
  try {
    url = new URL(String(raw));
  } catch {
    return { ok: false, reason: 'not a valid URL' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: `${url.protocol.replace(':', '')} URLs are not supported` };
  }
  // Credentials in a URL are a redirect-laundering trick and are never needed
  // for a public page.
  if (url.username || url.password) {
    return { ok: false, reason: 'URLs with embedded credentials are not accepted' };
  }
  const check = await hostnameResolvesSafely(url.hostname);
  if (!check.ok) return check;
  return { ok: true, url };
}

/**
 * fetch(), with every hop validated.
 *
 * Redirects are followed manually so the destination of each one is checked
 * the same way the original URL was — automatic redirect following is what
 * made the previous inline blocklists bypassable.
 *
 * @param {string} rawUrl
 * @param {object} [options]
 * @param {number} [options.timeoutMs]
 * @param {number} [options.maxRedirects]
 * @param {object} [options.headers]
 * @param {string} [options.method]
 * @returns {Promise<Response>} the final response, with `redirect: 'manual'`
 *   already resolved. Throws an Error whose message names the reason when a
 *   target is refused.
 */
async function safeFetch(rawUrl, options = {}) {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxRedirects = MAX_REDIRECTS,
    headers = {},
    method = 'GET',
  } = options;

  let current = rawUrl;
  const deadline = Date.now() + timeoutMs;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const check = await validateTarget(current);
    if (!check.ok) throw new Error(`Refused to fetch ${current}: ${check.reason}`);

    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error('Timed out before the request completed');

    const res = await fetch(check.url.toString(), {
      method,
      headers,
      redirect: 'manual',
      signal: AbortSignal.timeout(remaining),
    });

    if (res.status < 300 || res.status > 399) return res;

    const location = res.headers.get('location');
    if (!location) return res;   // a 3xx with nowhere to go is just a response

    // Resolve relative redirects against the URL we actually requested.
    current = new URL(location, check.url).toString();
  }

  throw new Error(`Too many redirects (more than ${maxRedirects})`);
}

/**
 * safeFetch() plus a bounded read of the body as text.
 *
 * A caller-supplied URL can point at an arbitrarily large file, so reading the
 * whole body into memory is itself an abuse vector. This stops at maxBytes and
 * returns what it has along with a flag, rather than pretending it read a
 * complete document.
 *
 * @returns {Promise<{status: number, url: string, text: string, truncated: boolean, headers: Headers}>}
 */
async function safeFetchText(rawUrl, options = {}) {
  const maxBytes = options.maxBytes || DEFAULT_MAX_BYTES;
  const res = await safeFetch(rawUrl, options);

  if (!res.body) {
    return { status: res.status, url: res.url || String(rawUrl), text: '', truncated: false, headers: res.headers };
  }

  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  let truncated = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      chunks.push(value.slice(0, value.length - (total - maxBytes)));
      truncated = true;
      try { await reader.cancel(); } catch { /* already closed */ }
      break;
    }
    chunks.push(value);
  }

  const text = Buffer.concat(chunks.map(c => Buffer.from(c))).toString('utf8');
  return { status: res.status, url: res.url || String(rawUrl), text, truncated, headers: res.headers };
}

module.exports = {
  safeFetch,
  safeFetchText,
  validateTarget,
  isBlockedAddress,
  isBlockedIPv4,
  isBlockedIPv6,
  expandIPv6,
  hostnameResolvesSafely,
};
