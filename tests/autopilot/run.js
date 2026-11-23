/**
 * Autopilot: agents that do the work on a schedule, repair what they can,
 * ask for what they need, and say what happened.
 *
 *   faults · schedule · secret box · Markdown · website connectors ·
 *   the runner + SEO Autopilot end to end (trust ramp, approvals, retries,
 *   reconnects, give-ups, GoDaddy hand-over) · the endpoints' access rules ·
 *   the pages.
 *
 *   node tests/autopilot/run.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
let failures = 0;
function check(label, ok) { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`); if (!ok) failures++; }
function mockModule(rel, exp) { const p = require.resolve(path.join(REPO, rel)); require.cache[p] = { id: p, filename: p, loaded: true, exports: exp }; }
const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');

/* ── An in-memory stand-in for Supabase's REST API (the filters we use) ── */
let clock = Date.parse('2026-11-23T21:00:00Z');
const nowIso = () => new Date(clock).toISOString();
const db = { connections: [], autopilots: [], agent_jobs: [], activity_events: [], seo_runs: [], seo_topics: [], seo_articles: [], profiles: [], projects: [], intelligence_profiles: [], mission_artifacts: [], experiments: [], search_snapshots: [] };
const DEFAULTS = {
  connections: { status: 'active', config: {}, status_note: null },
  autopilots: { enabled: true, mode: 'earn_trust', trust_required: 2, trust_earned: 0, settings: {}, cadence: {}, paused_reason: null, connection_id: null },
  agent_jobs: { state: {}, status: 'queued', step_attempts: 0, repairs: [], lock_until: null, last_error: null, result: null, finished_at: null },
  activity_events: { details: {}, action: null, read_at: null, resolved_at: null, emailed_at: null },
  seo_topics: { status: 'planned' },
};
let seq = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
const isUuid = (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v));
function field(row, key) {
  if (key.includes('->>')) { const [c, f] = key.split('->>'); const v = row[c] && row[c][f]; return v == null ? null : String(v); }
  return row[key];
}
function test(v, cond) {
  const i = cond.indexOf('.'); const op = cond.slice(0, i), arg = cond.slice(i + 1);
  if (op === 'not') return !test(v, arg);
  if (op === 'is') return arg === 'null' ? v == null : String(v) === arg;
  if (op === 'in') return arg.replace(/^\(|\)$/g, '').split(',').map(x => x.replace(/^"|"$/g, '')).includes(String(v));
  if (v == null) return false;
  const s = String(v);
  const cmp = typeof v === 'number' ? v - Number(arg) : (s < arg ? -1 : s > arg ? 1 : 0);
  return { eq: s === arg, neq: s !== arg, lt: cmp < 0, lte: cmp <= 0, gt: cmp > 0, gte: cmp >= 0 }[op];
}
function splitTop(sx) { const out = []; let depth = 0, cur = ''; for (const ch of sx) { if (ch === '(') depth++; if (ch === ')') depth--; if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch; } if (cur) out.push(cur); return out; }
function evalCond(row, c) {
  const m = c.match(/^(and|or)\((.*)\)$/);
  if (m) { const parts = splitTop(m[2]); return m[1] === 'and' ? parts.every(x => evalCond(row, x)) : parts.some(x => evalCond(row, x)); }
  const j = c.indexOf('.'); return test(field(row, c.slice(0, j)), c.slice(j + 1));
}
function matches(row, params) {
  for (const [k, v] of params) {
    if (['select', 'order', 'limit', 'on_conflict'].includes(k)) continue;
    if (k === 'or') { if (!evalCond(row, `or${v}`)) return false; }
    else if (!test(field(row, k), v)) return false;
  }
  return true;
}
const sbCalls = [];
async function sb(method, p, body) {
  sbCalls.push({ method, p, body });
  const [pathPart, qs = ''] = p.split('?');
  const table = pathPart.slice(1);
  const rows = db[table];
  if (!rows) return { ok: false, status: 404, data: null };
  const params = [...new URLSearchParams(qs)];
  const clone = (x) => JSON.parse(JSON.stringify(x));
  if (method === 'POST') {
    const list = (Array.isArray(body) ? body : [body]).map(b => ({ id: uuid(), created_at: nowIso(), ...clone(DEFAULTS[table] || {}), ...clone(b) }));
    rows.push(...list);
    return { ok: true, status: 201, data: clone(list) };
  }
  const hit = rows.filter(r => matches(r, params));
  if (method === 'PATCH') { hit.forEach(r => Object.assign(r, clone(body))); return { ok: true, status: 200, data: clone(hit) }; }
  const limit = Number((params.find(([k]) => k === 'limit') || [])[1]) || hit.length;
  return { ok: true, status: 200, data: clone(hit.slice(0, limit)) };
}

/* ── People ── */
const OWNER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', TEAMMATE = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', STRANGER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PROFILE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
db.intelligence_profiles.push({ id: PROFILE, owner_id: OWNER });
db.profiles.push({ id: OWNER, email: 'owner@example.com' });
const SHARED = { [TEAMMATE]: [PROFILE] };
let callerId = OWNER;

mockModule('api/_lib/supabase-rest.js', { sbRest: async (u, k, m, p, b) => sb(m, p, b), isUuid });
mockModule('api/_lib/rate-limit.js', { rateLimited: () => false });
mockModule('api/_lib/require-user.js', { requireUser: async (req, res) => (callerId ? { user: { id: callerId }, profile: { role: 'user' } } : (res.status(401).json({ error: 'Sign in' }), null)) });
mockModule('api/_lib/report-failure.js', { withFailureReporting: (n, fn) => fn, reportFailureAsync: () => {}, reportFailure: () => {} });
mockModule('api/_lib/profile-access.js', {
  canAccessRecord: async (u, k, caller, row) => {
    if (row.user_id && row.user_id === caller) return true;
    const pid = row.intel_profile_id;
    if (!pid) return false;
    const owner = (db.intelligence_profiles.find(p => p.id === pid) || {}).owner_id;
    return owner === caller || (SHARED[caller] || []).includes(pid);
  },
  accessibleProfileIds: async () => [], ownedOrSharedFilter: () => '',
});

function mkRes() { return { statusCode: 200, headers: {}, body: null, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; }, end() { return this; } }; }
async function api(handler, caller, body) { callerId = caller; const res = mkRes(); await handler({ method: 'POST', headers: {}, body }, res); return res; }

(async () => {
  process.env.SUPABASE_URL = 'https://db.example'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc';
  const faults = require(path.join(REPO, 'api/_lib/autopilot/faults.js'));
  const schedule = require(path.join(REPO, 'api/_lib/autopilot/schedule.js'));
  const box = require(path.join(REPO, 'api/_lib/secret-box.js'));
  const md = require(path.join(REPO, 'api/_lib/markdown.js'));
  const cms = require(path.join(REPO, 'api/_lib/cms.js'));

  console.log('\n──── faults: what kind of problem, and what is done about it ────');
  check('a refused login (401/403) is an auth fault', faults.classify({ status: 401 }).kind === 'auth' && faults.classify({ status: 403 }).kind === 'auth');
  check('429 is a rate limit, with the wait the service asked for', faults.classify({ status: 429, retryAfterMs: 90000 }).kind === 'rate_limited' && faults.classify({ status: 429, retryAfterMs: 90000 }).retryAfterMs === 90000);
  check('5xx, timeouts and dropped connections are transient', ['transient', 'transient', 'transient'].every((k, i) => faults.classify([{ status: 503 }, { name: 'TimeoutError', message: 'The operation was aborted due to timeout' }, { message: 'fetch failed' }][i]).kind === k));
  check('a kind set by the code that threw is honoured', faults.classify({ kind: 'site_unreachable', status: 500 }).kind === 'site_unreachable');
  check('anything else is permanent', faults.classify(new Error('Invalid slug')).kind === 'permanent');
  const waits = [0, 1, 2, 3, 4].map(a => faults.decide('transient', a).waitMs / 60000);
  check('transient: waits 2, 5, 15, 60, 180 minutes, then gives up', JSON.stringify(waits) === '[2,5,15,60,180]' && faults.decide('transient', 5).action === 'give_up');
  check('a rate limit waits at least as long as the service asked', faults.decide('rate_limited', 0, 40 * 60000).waitMs === 40 * 60000 && faults.decide('rate_limited', 0, 1000).waitMs === 15 * 60000);
  check('a refused login is never retried: it asks the business', faults.decide('auth', 0).action === 'ask_permission');
  check('a permanent fault is not retried', faults.decide('permanent', 0).action === 'give_up' && /will not fix itself/.test(faults.decide('permanent', 0).reason));
  check('a missing Audema setting gives up and says so', /missing a setting/.test(faults.decide('not_configured', 0).reason));
  check('descriptions are plain and bounded', /^A login was refused \(/.test(faults.describe('auth', new Error('nope'))) && faults.describe('permanent', new Error('x'.repeat(999))).length <= 220);

  console.log('\n──── schedule: the business\'s own days, hour and time zone ────');
  const syd = schedule.nextRunAt({ days: [2], hour: 9, timezone: 'Australia/Sydney' }, new Date('2026-11-22T00:00:00Z'));
  check('Tuesday 9am Sydney (summer time) is Monday 22:00 UTC', syd.toISOString() === '2026-11-23T22:00:00.000Z');
  const ny = schedule.nextRunAt({ days: [1], hour: 9, timezone: 'America/New_York' }, new Date('2026-03-07T12:00:00Z'));
  check('…and clocks changing are followed (New York, the Monday after DST starts → 13:00 UTC)', ny.toISOString() === '2026-03-09T13:00:00.000Z');
  const same = schedule.nextRunAt({ days: [1], hour: 9, timezone: 'UTC' }, new Date('2026-11-23T09:00:00Z'));
  check('the next run is strictly after now (no double run at the same minute)', same.toISOString() === '2026-11-30T09:00:00.000Z');
  const cc = schedule.cleanCadence({ days: [9, 'x', 3, 3], hour: 99, timezone: 'Mars/Base' });
  check('a bad cadence is cleaned, not trusted', JSON.stringify(cc) === '{"days":[3],"hour":23,"timezone":"UTC"}' && JSON.stringify(schedule.cleanCadence(null).days) === '[2]');

  console.log('\n──── secret box: logins are stored encrypted, or not at all ────');
  delete process.env.CONNECTIONS_ENCRYPTION_KEY;
  let threw = null; try { box.seal({ a: 1 }); } catch (e) { threw = e; }
  check('with no key, nothing is stored (fails closed, says which setting)', threw && threw.kind === 'not_configured' && /CONNECTIONS_ENCRYPTION_KEY/.test(threw.message) && !box.isConfigured());
  process.env.CONNECTIONS_ENCRYPTION_KEY = 'k'.repeat(48);
  const sealed = box.seal({ appPassword: 'abcd efgh' });
  check('sealed value is versioned and does not contain the secret', /^v1\.[\w-]+\.[\w-]+\.[\w-]+$/.test(sealed) && !sealed.includes('abcd'));
  check('it opens back to the same secret', box.open(sealed).appPassword === 'abcd efgh');
  check('two seals of the same secret differ (fresh IV each time)', box.seal({ a: 1 }) !== box.seal({ a: 1 }));
  const parts = sealed.split('.'); parts[3] = parts[3].slice(0, -2) + (parts[3].endsWith('AA') ? 'BB' : 'AA');
  threw = null; try { box.open(parts.join('.')); } catch (e) { threw = e; }
  check('a tampered secret is refused as a login problem (reconnect), not used', threw && threw.kind === 'auth');
  process.env.CONNECTIONS_ENCRYPTION_KEY = 'z'.repeat(48);
  threw = null; try { box.open(sealed); } catch (e) { threw = e; }
  check('a changed key means reconnect, not a crash', threw && threw.kind === 'auth' && /key may have changed/.test(threw.message));
  process.env.CONNECTIONS_ENCRYPTION_KEY = 'k'.repeat(48);

  console.log('\n──── Markdown → each platform\'s format ────');
  const art = '# Title\n\nIntro with **bold**, *it*, `code` and a [link](https://example.com/a).\n\n## Steps\n\n- one\n- two <script>alert(1)</script>\n\n1. first\n2. second\n\n> quoted\n\n[bad](javascript:alert(1)) and [also bad](data:text/html,x) and [wiki](https://en.wikipedia.org/wiki/Drain_(plumbing)).';
  const html = md.toHtml(art, { dropFirstH1: true });
  check('the H1 is dropped when the platform shows the title itself', !/<h1>/.test(html) && /<h2>Steps<\/h2>/.test(html) && /<h1>Title<\/h1>/.test(md.toHtml(art)));
  check('bold, italic, code, lists, quotes', /<strong>bold<\/strong>/.test(html) && /<em>it<\/em>/.test(html) && /<code>code<\/code>/.test(html) && /<ul><li>one<\/li>/.test(html) && /<ol><li>first<\/li><li>second<\/li><\/ol>/.test(html) && /<blockquote><p>quoted<\/p><\/blockquote>/.test(html));
  check('model-written HTML is escaped, never run', /&lt;script&gt;/.test(html) && !/<script>/.test(html));
  check('only http(s) links survive; others keep their words only', /<a href="https:\/\/example.com\/a">link<\/a>/.test(html) && !/javascript:|data:text/.test(html) && /bad and also bad/.test(html) && html.includes('<a href="https://en.wikipedia.org/wiki/Drain_(plumbing)">wiki</a>.'));
  const ricos = md.toRicos(art, { dropFirstH1: true });
  const types = ricos.nodes.map(n => n.type);
  check('Wix rich content: headings, lists, quote, paragraphs', types.includes('HEADING') && types.includes('BULLETED_LIST') && types.includes('ORDERED_LIST') && types.includes('BLOCKQUOTE') && types[0] === 'PARAGRAPH');
  const linkNode = JSON.stringify(ricos).includes('"url":"https://example.com/a"') && !JSON.stringify(ricos).includes('javascript:');
  check('…with the same link rules', linkNode);
  check('plain text and link list', md.toText('A [b](https://x.y) **c**') === 'A b c' && md.links(art).length === 4);

  console.log('\n──── website connectors ────');
  const reqs = [];
  const okTarget = { validateTarget: async (u) => ({ ok: true, url: new URL(u) }) };
  const resp = (status, body, headers = {}) => ({ ok: status >= 200 && status < 300, status, headers: { get: (k) => headers[k.toLowerCase()] || null }, json: async () => body, text: async () => JSON.stringify(body) });
  const fetchWith = (routes) => async (url, init) => { reqs.push({ url, init }); for (const [re, r] of routes) if (re.test(url)) return typeof r === 'function' ? r(url, init) : r; return resp(404, { message: 'no route' }); };
  const { wordpress, webflow, shopify, wix, godaddy } = cms.PROVIDERS;

  reqs.length = 0;
  let v = await wordpress.verify({ siteUrl: 'example.com/blog', username: 'sam', appPassword: 'abcd efgh ijkl' }, { ...okTarget, fetch: fetchWith([[/users\/me/, resp(200, { name: 'Sam', capabilities: { publish_posts: true } })]]) });
  check('WordPress: checks the login against users/me with the application password (spaces removed)', reqs[0].url === 'https://example.com/wp-json/wp/v2/users/me?context=edit' && reqs[0].init.headers.Authorization === 'Basic ' + Buffer.from('sam:abcdefghijkl').toString('base64'));
  check('…stores the site origin, and the secret only in the secret bundle', v.siteUrl === 'https://example.com' && v.secret.appPassword === 'abcd efgh ijkl' && !JSON.stringify(v.config).includes('abcd'));
  check('…never follows a redirect', reqs[0].init.redirect === 'manual');
  threw = null;
  try { await wordpress.verify({ siteUrl: 'https://example.com', username: 'sam', appPassword: 'x' }, { ...okTarget, fetch: fetchWith([[/users\/me/, resp(200, { capabilities: { publish_posts: false } })]]) }); } catch (e) { threw = e; }
  check('…a user who can\'t publish is refused up front, with what to do', threw && /not allowed to publish/.test(threw.message));
  threw = null;
  try { await wordpress.verify({ siteUrl: 'http://10.0.0.5', username: 'a', appPassword: 'b' }, { validateTarget: async () => ({ ok: false, reason: 'hostname resolves to a private or reserved address' }) }); } catch (e) { threw = e; }
  check('…a private address is refused', threw && /private or reserved/.test(threw.message));
  threw = null;
  try { await wordpress.verify({ siteUrl: 'https://example.com', username: 'a', appPassword: 'b' }, { ...okTarget, fetch: fetchWith([]) }); } catch (e) { threw = e; }
  check('…a site that isn\'t WordPress is told so', threw && /does not answer as WordPress/.test(threw.message));

  const wpConn = { site_url: 'https://example.com', config: {}, secret: { username: 'sam', appPassword: 'abcd' } };
  reqs.length = 0;
  let out = await wordpress.publish(wpConn, { title: 'T', markdown: '# T\n\nBody', excerpt: 'E', slug: 't' }, { status: 'draft' }, { fetch: fetchWith([[/wp\/v2\/posts$/, resp(201, { id: 7, link: 'https://example.com/t', status: 'draft' })]]) });
  const wpBody = JSON.parse(reqs[0].init.body);
  check('WordPress publish: HTML body without the H1, as a draft when asked', wpBody.content === '<p>Body</p>' && wpBody.status === 'draft' && wpBody.slug === 't' && out.url === 'https://example.com/t' && out.remoteId === '7');
  reqs.length = 0;
  const found = await wordpress.findExisting(wpConn, { slug: 'my post' }, { fetch: fetchWith([[/posts\?slug=/, resp(200, [{ id: 9, link: 'https://example.com/my-post', status: 'publish' }])]]) });
  check('WordPress: a retry finds the post already there by its slug', found && found.remoteId === '9' && /slug=my%20post/.test(reqs[0].url));

  const fail401 = await cms.httpFail(resp(401, { message: 'Sorry, you are not allowed' }), 'WordPress');
  check('401 → auth, with the site\'s own words', fail401.kind === 'auth' && /not allowed/.test(fail401.message));
  const fail429 = await cms.httpFail(resp(429, {}, { 'retry-after': '120' }), 'Shopify');
  check('429 → rate limited, honouring Retry-After', fail429.kind === 'rate_limited' && fail429.retryAfterMs === 120000);
  const fail301 = await cms.httpFail(resp(301, {}, { location: 'https://new.example.com/' }), 'WordPress');
  check('a redirect → permanent, naming where it went', fail301.kind === 'permanent' && /new\.example\.com/.test(fail301.message));
  threw = null; try { await wordpress.publish(wpConn, { title: 'T', markdown: 'x' }, { status: 'publish' }, { fetch: async () => { throw new Error('getaddrinfo ENOTFOUND'); } }); } catch (e) { threw = e; }
  check('a dropped connection → transient (retried)', threw && threw.kind === 'transient' && faults.classify(threw).kind === 'transient');

  const wfFields = [{ slug: 'name', type: 'PlainText', isRequired: true }, { slug: 'slug', type: 'PlainText', isRequired: true }, { slug: 'post-body', type: 'RichText' }, { slug: 'post-summary', type: 'PlainText' }];
  const wfRoutes = (fields) => fetchWith([
    [/\/v2\/sites$/, resp(200, { sites: [{ id: 's1', displayName: 'Acme', shortName: 'acme', customDomains: [] }] })],
    [/sites\/s1\/collections/, resp(200, { collections: [{ id: 'c0', slug: 'team', displayName: 'Team' }, { id: 'c1', slug: 'blog-posts', displayName: 'Blog Posts' }] })],
    [/collections\/c1$/, resp(200, { fields })],
  ]);
  v = await webflow.verify({ token: 'tok' }, { fetch: wfRoutes(wfFields) });
  check('Webflow: finds the blog collection, its rich-text body and summary fields', v.config.collectionId === 'c1' && v.config.fieldMap.body === 'post-body' && v.config.fieldMap.summary === 'post-summary' && v.siteUrl === 'https://acme.webflow.io');
  threw = null; try { await webflow.verify({ token: 'tok' }, { fetch: wfRoutes([...wfFields, { slug: 'author', displayName: 'Author', type: 'Reference', isRequired: true }]) }); } catch (e) { threw = e; }
  check('…refuses a collection with required fields it can\'t fill, naming them', threw && /Author/.test(threw.message));
  reqs.length = 0;
  out = await webflow.publish({ site_url: 'https://acme.com', config: v.config, secret: { token: 'tok' } }, { title: 'T', markdown: 'Body', excerpt: 'E', slug: 't' }, { status: 'publish' }, { fetch: fetchWith([[/items\/live$/, resp(202, { id: 'i1', fieldData: { slug: 't' } })]]) });
  const wfBody = JSON.parse(reqs[0].init.body);
  check('Webflow publish: live item, body and summary in the right fields, real URL', /collections\/c1\/items\/live$/.test(reqs[0].url) && wfBody.fieldData['post-body'] === '<p>Body</p>' && wfBody.fieldData['post-summary'] === 'E' && out.url === 'https://acme.com/blog-posts/t');

  threw = null; try { await shopify.verify({ shopDomain: 'mystore.com', token: 't' }); } catch (e) { threw = e; }
  check('Shopify: asks for the .myshopify.com address', threw && /myshopify\.com/.test(threw.message));
  reqs.length = 0;
  const shopConn = { site_url: 'https://shop.example', config: { shop: 'acme.myshopify.com', blogId: 5, blogHandle: 'news', author: 'Sam' }, secret: { token: 'shpat' } };
  out = await shopify.publish(shopConn, { title: 'T', markdown: 'Body', excerpt: 'E <b>', slug: 't' }, { status: 'draft' }, { fetch: fetchWith([[/articles\.json$/, resp(201, { article: { id: 3, handle: 't' } })]]) });
  const shBody = JSON.parse(reqs[0].init.body).article;
  check('Shopify publish: to the chosen blog, unpublished for a draft (no URL claimed)', /\/admin\/api\/2025-01\/blogs\/5\/articles\.json$/.test(reqs[0].url) && reqs[0].init.headers['X-Shopify-Access-Token'] === 'shpat' && shBody.published === false && out.url === null && shBody.summary_html === '<p>E b</p>');

  reqs.length = 0;
  const wixConn = { site_url: null, config: { siteId: '11111111-2222-3333-4444-555555555555', memberId: null }, secret: { apiKey: 'IST.key' } };
  out = await wix.publish(wixConn, { title: 'T', markdown: '## H\n\nBody', excerpt: 'E', slug: 't' }, { status: 'publish' }, { fetch: fetchWith([[/draft-posts$/, resp(200, { draftPost: { id: 'p1', url: { base: 'https://acme.wixsite.com/site/', path: '/post/t' } } })]]) });
  const wxBody = JSON.parse(reqs[0].init.body);
  check('Wix publish: rich content, published, with the site id header and the real URL', wxBody.publish === true && wxBody.draftPost.richContent.nodes[0].type === 'HEADING' && reqs[0].init.headers['wix-site-id'] === wixConn.config.siteId && out.url === 'https://acme.wixsite.com/site/post/t');
  threw = null; try { await wix.publish(wixConn, { title: 'T', markdown: 'x' }, { status: 'publish' }, { fetch: fetchWith([[/draft-posts$/, resp(400, { message: 'memberId is required for third-party apps' })]]) }); } catch (e) { threw = e; }
  check('…Wix asking for an author becomes a request to the business (not a silent failure)', threw && threw.kind === 'auth' && /Member ID/.test(threw.message));
  threw = null; try { await godaddy.publish(); } catch (e) { threw = e; }
  check('GoDaddy Website Builder: says it has no publishing API (the autopilot hands over the post)', threw && threw.kind === 'unsupported');
  reqs.length = 0;
  const wfFound = await webflow.findExisting({ site_url: 'https://acme.com', config: v.config, secret: { token: 'tok' } }, { slug: 't' }, { fetch: fetchWith([[/items\?slug=t$/, resp(200, { items: [{ id: 'i9', isDraft: false, fieldData: { slug: 't' } }] })]]) });
  const wixMissing = await wix.findExisting(wixConn, { slug: 'nope' }, { fetch: fetchWith([]) });
  check('Webflow and Wix also find a post already there (a 404 just means "not yet")', wfFound && wfFound.url === 'https://acme.com/blog-posts/t' && wixMissing === null);
  check('every connector except GoDaddy can find an existing post before a retry', ['wordpress', 'webflow', 'shopify', 'wix'].every(k => typeof cms.PROVIDERS[k].findExisting === 'function'));
  reqs.length = 0;
  await wordpress.update(wpConn, '7', { title: 'T2', markdown: '# T2\n\nNew body', excerpt: 'E2' }, { fetch: fetchWith([[/wp\/v2\/posts\/7$/, resp(200, { id: 7, link: 'https://example.com/t' })]]) });
  await shopify.update(shopConn, '3', { title: 'T2', markdown: 'New body', excerpt: 'E2' }, { fetch: fetchWith([[/articles\/3\.json$/, resp(200, { article: { id: 3, handle: 't' } })]]) });
  await wix.update(wixConn, 'p1', { title: 'T2', markdown: 'New body', excerpt: 'E2' }, { fetch: fetchWith([[/draft-posts\/p1$/, resp(200, { draftPost: { id: 'p1' } })]]) });
  check('updating a live post changes that post in place (WordPress, Shopify, Wix republish)', JSON.parse(reqs[0].init.body).content === '<p>New body</p>' && reqs[1].init.method === 'PUT' && JSON.parse(reqs[1].init.body).article.id === 3 && reqs[2].init.method === 'PATCH' && JSON.parse(reqs[2].init.body).action === 'UPDATE_PUBLISH');
  check('every connector can check its login strictly (ping)', Object.values(cms.PROVIDERS).every(p => typeof p.ping === 'function'));

  /* ── Endpoints + runner, end to end ── */
  const registry = require(path.join(REPO, 'api/_lib/autopilot/registry.js'));
  const runner = require(path.join(REPO, 'api/_lib/autopilot/runner.js'));
  const connectionsApi = require(path.join(REPO, 'api/connections.js'));
  const autopilotApi = require(path.join(REPO, 'api/autopilot.js'));
  const activityApi = require(path.join(REPO, 'api/activity.js'));

  process.env.RESEND_API_KEY = 're_x'; process.env.RESEND_FROM_EMAIL = 'hello@audema.example'; process.env.APP_BASE_URL = 'https://app.example/';
  const emails = [];
  const words = (n) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');
  const calls = { analyze: 0, propose: [], write: 0, publish: [], find: 0 };
  let writePlan = [];   // per-call overrides for writeArticle: 'short' | 'placeholder' | Error
  let publishPlan = []; // per-call errors for publish
  const seo = {
    analyzeSite: async () => { calls.analyze++; return { profile: { business_summary: 'Emergency plumbers in Sydney', products_services: ['Emergency plumbing'], target_customer: 'Homeowners', existing_topics: [] } }; },
    proposeTopics: async (args) => { calls.propose.push(args); if (calls.propose.length > 1) return [{ topic: `Plumbing question ${calls.propose.length}`, target_keyword: `plumbing question ${calls.propose.length}`, est_difficulty: 'low' }]; return [{ topic: 'Signs of a blocked drain', target_keyword: 'blocked drain signs', est_difficulty: 'high', est_search_volume: 'high' }, { topic: 'Hot water system repair', target_keyword: 'hot water repair', est_difficulty: 'low', est_search_volume: 'medium' }]; },
    writeArticle: async ({ topic, siteLinks }) => {
      calls.write++;
      const p = writePlan.length ? writePlan.shift() : null;
      if (p instanceof Error) throw p;
      const n = p === 'short' ? 120 : 520;
      const extra = p === 'placeholder' ? ' Call us on [Your phone number] today.' : '';
      return { title: `${topic.topic}: a guide`, meta_description: 'What to do.', slug: topic.target_keyword.replace(/\s+/g, '-'), target_keyword: topic.target_keyword, body_markdown: `# ${topic.topic}\n\n${words(n)} See [our services](${(siteLinks[0] || {}).url || 'https://example.com/services'}) and [a random site](https://elsewhere.example/x).${extra}`, schema_markup: {} };
    },
  };
  const wpMock = {
    ...cms.PROVIDERS.wordpress,
    listPages: async () => [{ title: 'Services', url: 'https://example.com/services' }],
    findExisting: async () => { calls.find++; return null; },
    publish: async (conn, post, opts) => { calls.publish.push({ conn, post, opts }); const p = publishPlan.shift(); if (p) throw p; return { url: `https://example.com/${post.slug}`, remoteId: String(calls.publish.length), status: opts.status }; },
  };
  const deps = { registry, now: () => clock, seo, providers: { wordpress: wpMock, godaddy: cms.PROVIDERS.godaddy }, fetch: async (url, init) => { emails.push({ url, body: JSON.parse(init.body) }); return { ok: true }; } };
  const tick = () => runner.tick(sb, deps);
  const events = (kind) => db.activity_events.filter(e => !kind || e.kind === kind);
  const lastEvent = (kind) => events(kind).slice(-1)[0];

  console.log('\n──── Connections ────');
  const realVerify = cms.PROVIDERS.wordpress.verify;
  cms.PROVIDERS.wordpress.verify = async (f) => { if (f.appPassword === 'wrong') { const e = new Error('WordPress refused the login'); e.kind = 'auth'; throw e; } return { label: 'WordPress — example.com', siteUrl: 'https://example.com', config: { userName: 'Sam' }, secret: { username: f.username, appPassword: f.appPassword } }; };
  let r = await api(connectionsApi, OWNER, { action: 'providers' });
  check('the five platforms are offered, each with what it needs and how to get it', ['wordpress', 'webflow', 'shopify', 'wix', 'godaddy'].every(id => r.body.providers.some(p => p.id === id && p.needs.length && p.help)) && r.body.encryptionConfigured === true);
  r = await api(connectionsApi, OWNER, { action: 'connect', provider: 'wordpress', intelProfileId: PROFILE, fields: { siteUrl: 'example.com', username: 'sam', appPassword: 'wrong' } });
  check('a login that doesn\'t work is not saved', r.statusCode === 401 && db.connections.length === 0);
  r = await api(connectionsApi, OWNER, { action: 'connect', provider: 'wordpress', intelProfileId: PROFILE, fields: { siteUrl: 'example.com', username: 'sam', appPassword: 'abcd efgh' } });
  const conn = db.connections[0];
  check('a working login is saved encrypted, under the business', r.statusCode === 200 && conn && conn.intel_profile_id === PROFILE && conn.user_id === OWNER && /^v1\./.test(conn.secret_enc) && !conn.secret_enc.includes('abcd') && box.open(conn.secret_enc).appPassword === 'abcd efgh');
  check('the response never carries the secret', !JSON.stringify(r.body).includes('secret') && !JSON.stringify(r.body).includes('abcd'));
  r = await api(connectionsApi, STRANGER, { action: 'list', intelProfileId: PROFILE });
  check('someone outside the business can\'t list its connections', r.statusCode === 403);
  r = await api(connectionsApi, STRANGER, { action: 'disconnect', id: conn.id });
  check('…or disconnect one', r.statusCode === 404 && conn.status === 'active');
  r = await api(connectionsApi, TEAMMATE, { action: 'list', intelProfileId: PROFILE });
  check('a teammate on the shared business sees it', r.statusCode === 200 && r.body.connections.length === 1 && !('secret_enc' in r.body.connections[0]));
  const savedKey = process.env.CONNECTIONS_ENCRYPTION_KEY; delete process.env.CONNECTIONS_ENCRYPTION_KEY;
  r = await api(connectionsApi, OWNER, { action: 'connect', provider: 'wordpress', intelProfileId: PROFILE, fields: { siteUrl: 'x.com', username: 'a', appPassword: 'b' } });
  check('with no encryption key, connecting is refused (503) rather than storing plain text', r.statusCode === 503 && r.body.code === 'not_configured' && db.connections.length === 1);
  process.env.CONNECTIONS_ENCRYPTION_KEY = savedKey;

  console.log('\n──── SEO Autopilot settings ────');
  r = await api(autopilotApi, OWNER, { action: 'save', agent: 'seo', intelProfileId: PROFILE, connectionId: conn.id, mode: 'earn_trust', cadence: { days: [2], hour: 9, timezone: 'Australia/Sydney' }, settings: { topics: 'Emergency plumber Sydney\n', siteUrl: 'https://example.com', neverSay: 'cheapest in town', region: 'AU', language: 'xx-nope' } });
  const ap = db.autopilots[0];
  check('saved for the business, with the next run in its own time zone', r.statusCode === 200 && ap.intel_profile_id === PROFILE && ap.user_id === OWNER && ap.next_run_at === '2026-11-23T22:00:00.000Z');
  check('settings are cleaned (topics list, an unknown language dropped)', JSON.stringify(ap.settings.topics) === '["Emergency plumber Sydney"]' && ap.settings.language === '' && ap.settings.region === 'AU' && ap.settings.publishAs === 'publish');
  r = await api(autopilotApi, STRANGER, { action: 'save', agent: 'seo', intelProfileId: PROFILE, mode: 'auto' });
  check('an outsider can\'t change it', r.statusCode === 403 && ap.mode === 'earn_trust');
  r = await api(autopilotApi, OWNER, { action: 'save', agent: 'nope', intelProfileId: PROFILE });
  check('an agent without an autopilot is refused plainly', r.statusCode === 400 && /can't run on autopilot/.test(r.body.error));
  const other = { id: uuid(), user_id: STRANGER, provider: 'wordpress', status: 'active', label: 'Not yours', intel_profile_id: null };
  db.connections.push(other);
  r = await api(autopilotApi, OWNER, { action: 'save', agent: 'seo', intelProfileId: PROFILE, connectionId: other.id });
  check('…and it can\'t publish to someone else\'s connection', r.statusCode === 400 && ap.connection_id === conn.id);

  console.log('\n──── Run 1: earning trust — it does the work, then asks ────');
  let t = await tick();
  check('nothing runs before it is due', t.scheduled === 0 && db.agent_jobs.length === 0);
  clock = Date.parse('2026-11-23T22:01:00Z');
  t = await tick();
  const job1 = db.agent_jobs[0];
  check('when due, a job is created and the next run scheduled (a week on)', t.scheduled === 1 && ap.next_run_at === '2026-11-30T22:00:00.000Z' && ap.last_run_at === nowIso());
  check('with no saved profile, it read the website first', calls.analyze === 1 && db.seo_runs.length === 1 && db.seo_runs[0].intel_profile_id === PROFILE);
  check('the business\'s own topic was used first', db.seo_topics.length === 1 && db.seo_topics[0].topic === 'emergency plumber sydney' && job1.state.topic.topic === 'emergency plumber sydney');
  const a1 = db.seo_articles[0];
  check('the draft was saved', a1 && a1.status === 'draft' && a1.word_count > 400);
  check('links that aren\'t the site\'s own were removed, the site\'s own kept', !a1.body_markdown.includes('elsewhere.example') && a1.body_markdown.includes('a random site') && a1.body_markdown.includes('(https://example.com/services)'));
  check('it waits for approval (trust is being earned), at the publish step', job1.status === 'waiting_approval' && job1.step === 'publish' && calls.publish.length === 0);
  const ask1 = lastEvent('needs_approval');
  check('the inbox asks, saying why and what was changed', ask1 && ask1.job_id === job1.id && ask1.intel_profile_id === PROFILE && /approved 2 articles \(0 so far\)/.test(ask1.body) && /Removed 1 link/.test(ask1.body) && ask1.action.type === 'approve' && ask1.action.articleId === a1.id);
  check('…and emails the owner a link to What happened', emails.length === 1 && emails[0].body.to[0] === 'owner@example.com' && /Ready for your OK/.test(emails[0].body.subject) && emails[0].body.html.includes('https://app.example/inbox.html') && ask1.emailed_at);

  ap.next_run_at = new Date(clock - 1000).toISOString();
  t = await tick();
  check('a due run while work is still open starts nothing new (one piece at a time)', t.scheduled === 0 && db.agent_jobs.length === 1 && ap.next_run_at > nowIso());

  r = await api(autopilotApi, STRANGER, { action: 'approve', jobId: job1.id });
  check('an outsider can\'t approve', r.statusCode === 404 && job1.status === 'waiting_approval');
  r = await api(autopilotApi, OWNER, { action: 'article', articleId: a1.id });
  check('the article preview is escaped HTML from the server', r.statusCode === 200 && r.body.article.html.includes('<p>') && !r.body.article.html.includes('<h1>'));
  r = await api(autopilotApi, STRANGER, { action: 'article', articleId: a1.id });
  check('…and only for the business', r.statusCode === 404);
  r = await api(autopilotApi, OWNER, { action: 'approve', jobId: job1.id, edits: { title: 'Emergency plumber in Sydney: what to do first' } });
  check('approving (with an edit) queues the publish and counts toward trust', r.statusCode === 200 && job1.status === 'queued' && ap.trust_earned === 1 && a1.title === 'Emergency plumber in Sydney: what to do first' && ask1.resolved_at);
  r = await api(autopilotApi, OWNER, { action: 'approve', jobId: job1.id });
  check('answering twice is refused', r.statusCode === 409);
  await tick();
  check('it published the edited article as a live post', calls.publish.length === 1 && calls.publish[0].post.title === 'Emergency plumber in Sydney: what to do first' && calls.publish[0].opts.status === 'publish' && calls.publish[0].conn.secret.appPassword === 'abcd efgh');
  check('…recorded the real URL, and marked the topic written', job1.status === 'done' && a1.status === 'published' && a1.published_url === 'https://example.com/emergency-plumber-sydney' && db.seo_topics[0].status === 'written' && conn.last_ok_at);
  const done1 = lastEvent('done');
  check('…and says so in the inbox, with a link (no email for good news)', done1 && /Published on WordPress/.test(done1.title) && done1.action.url === a1.published_url && emails.length === 1 && !events('repaired').length);

  console.log('\n──── Run 2: fresh topics, a server hiccup repaired ────');
  r = await api(autopilotApi, OWNER, { action: 'runNow', id: ap.id });
  check('"Write one now" starts a job', r.statusCode === 200 && db.agent_jobs.length === 2);
  r = await api(autopilotApi, OWNER, { action: 'runNow', id: ap.id });
  check('…but not a second at the same time', r.statusCode === 409);
  await tick();
  const job2 = db.agent_jobs[1];
  check('the saved profile is reused (the website isn\'t read again)', calls.analyze === 1);
  check('when the plan runs out it proposes new topics, never repeating a written one', calls.propose.length === 1 && calls.propose[0].avoid.includes('emergency plumber sydney'));
  check('…and starts with the easiest to rank', job2.state.topic.topic === 'Hot water system repair');
  check('still earning trust (1 of 2), so it asks', job2.status === 'waiting_approval' && /\(1 so far\)/.test(lastEvent('needs_approval').body));
  r = await api(autopilotApi, TEAMMATE, { action: 'approve', jobId: job2.id });
  check('a teammate on the business can approve', r.statusCode === 200 && ap.trust_earned === 2);
  check('trust earned: the business is told it now runs on its own', /now runs on its own/.test(lastEvent('info').title));
  const e503 = Object.assign(new Error('WordPress had a server error (503)'), { status: 503, kind: 'transient' });
  publishPlan = [e503];
  await tick();
  check('a server error: waited and will try again (in 2 min), nothing failed', job2.status === 'queued' && job2.step_attempts === 1 && job2.run_at === new Date(clock + 120000).toISOString() && job2.repairs.length === 1 && /server error/.test(job2.last_error) && !events('failed').length);
  await tick();
  check('…not before the wait is over', calls.publish.length === 2);
  clock += 3 * 60000;
  await tick();
  check('…then, before posting again, it checks the post didn\'t already go up', calls.find === 1);
  check('…and publishes', job2.status === 'done' && calls.publish.length === 3);
  const rep = lastEvent('repaired');
  check('the business is told what went wrong and what was done', rep && /fixed 1 problem/.test(rep.title) && /server error/.test(rep.body) && /waited and tried again/.test(rep.body) && rep.job_id === job2.id);

  console.log('\n──── Run 3: on its own; a login stops working ────');
  await api(autopilotApi, OWNER, { action: 'runNow', id: ap.id });
  publishPlan = [Object.assign(new Error('WordPress refused the login: Incorrect password'), { status: 401, kind: 'auth' })];
  const emailsBefore = emails.length;
  await tick();
  const job3 = db.agent_jobs[2];
  check('trust earned: wrote and went straight to publishing (no approval asked)', calls.publish.length === 4 && !events('needs_approval').some(e => e.job_id === job3.id));
  check('a refused login: the connection is marked, the work waits — no retrying a password', conn.status === 'needs_attention' && /refused/.test(conn.status_note) && job3.status === 'waiting_permission' && job3.state.waitingFor === conn.id && job3.step === 'publish');
  const perm = lastEvent('needs_permission');
  check('…and the business is asked to reconnect (inbox + email), told nothing was changed', perm && perm.action.type === 'reconnect' && perm.action.connectionId === conn.id && /Nothing was changed/.test(perm.body) && emails.length === emailsBefore + 1);
  ap.next_run_at = new Date(clock - 1000).toISOString();
  await tick();
  check('scheduled runs don\'t pile up while it waits', db.agent_jobs.length === 3);
  r = await api(activityApi, OWNER, { action: 'dismiss', id: perm.id });
  check('a request for a login can\'t be dismissed away — only answered', r.body.updated === 0 && !perm.resolved_at);
  r = await api(connectionsApi, OWNER, { action: 'connect', provider: 'wordpress', connectionId: conn.id, fields: { siteUrl: 'example.com', username: 'sam', appPassword: 'new pass' } });
  check('reconnecting: the login is replaced and checked, the request cleared', r.statusCode === 200 && conn.status === 'active' && box.open(conn.secret_enc).appPassword === 'new pass' && perm.resolved_at);
  check('…and the waiting work carries on from where it stopped', r.body.resumed === 1 && job3.status === 'queued' && /picked up where it stopped/.test(lastEvent('info').body));
  await tick();
  check('…publishing with the new login', job3.status === 'done' && calls.publish.slice(-1)[0].conn.secret.appPassword === 'new pass');

  console.log('\n──── Run 4: on autopilot, but a check finds a problem ────');
  ap.mode = 'auto';
  writePlan = ['placeholder'];
  await api(autopilotApi, OWNER, { action: 'runNow', id: ap.id });
  await tick();
  const job4 = db.agent_jobs[3];
  check('an unfilled placeholder stops it even on full autopilot', job4.status === 'waiting_approval' && /needs a look/.test(lastEvent('needs_approval').body) && /Your phone number/.test(lastEvent('needs_approval').body));
  r = await api(autopilotApi, OWNER, { action: 'reject', jobId: job4.id });
  check('"Don\'t publish": nothing goes up, the topic is set aside', r.statusCode === 200 && job4.status === 'cancelled' && db.seo_topics.find(x => x.id === job4.state.topicId).status === 'skipped' && calls.publish.length === 5);

  console.log('\n──── Run 5: too short → rewritten once → still short → asks ────');
  writePlan = ['short', 'short'];
  const writesBefore = calls.write;
  await api(autopilotApi, OWNER, { action: 'runNow', id: ap.id });
  await tick(); await tick();
  const job5 = db.agent_jobs[4];
  const ask5 = lastEvent('needs_approval');
  check('a short draft is rewritten once, then the business is asked', calls.write === writesBefore + 2 && job5.status === 'waiting_approval' && /only \d+ words/.test(ask5.body) && /rewritten/.test(ask5.body));
  await api(autopilotApi, OWNER, { action: 'reject', jobId: job5.id });

  console.log('\n──── Run 6: the AI keeps failing → gives up, says what was tried ────');
  const modelErr = () => Object.assign(new Error('The article came back without a body'), { kind: 'model' });
  writePlan = [modelErr(), modelErr(), modelErr(), modelErr()];
  await api(autopilotApi, OWNER, { action: 'runNow', id: ap.id });
  const job6 = db.agent_jobs[5];
  for (let i = 0; i < 4; i++) { await tick(); clock += 20 * 60000; }
  const failed = lastEvent('failed');
  check('after 3 more tries it stops and fails the job', job6.status === 'failed' && job6.repairs.length === 3);
  check('…telling the business what went wrong, what was tried, and that nothing was published', failed && failed.job_id === job6.id && /couldn't finish: writing the article/.test(failed.title) && (failed.body.match(/asked the AI again/g) || []).length === 3 && /Nothing was published/.test(failed.body));
  r = await api(autopilotApi, OWNER, { action: 'retry', jobId: job6.id });
  check('"Try again" picks it up from where it stopped and clears the alert', r.statusCode === 200 && job6.status === 'queued' && job6.step === 'write' && job6.step_attempts === 0 && failed.resolved_at);
  await tick();
  check('…and this time it finishes', job6.status === 'done');

  console.log('\n──── GoDaddy Website Builder: a ready-to-paste post ────');
  const gd = { id: uuid(), user_id: OWNER, intel_profile_id: PROFILE, provider: 'godaddy', label: 'GoDaddy — example.com', site_url: 'https://example.com', config: {}, secret_enc: box.seal({}), status: 'active' };
  db.connections.push(gd);
  ap.connection_id = gd.id;
  await api(autopilotApi, OWNER, { action: 'runNow', id: ap.id });
  await tick();
  const job7 = db.agent_jobs[6];
  const copy = lastEvent('done');
  check('it doesn\'t pretend to publish: the job is done as a hand-over', job7.status === 'done' && job7.result.manual === true && calls.publish.length === 6);
  check('…the inbox offers the article to copy', copy && /Ready to paste into GoDaddy/.test(copy.title) && copy.action.type === 'copy_article' && db.seo_articles.find(x => x.id === copy.action.articleId).status === 'draft');

  console.log('\n──── runner safety ────');
  const locked = { id: uuid(), user_id: OWNER, autopilot_id: ap.id, agent: 'seo', kind: 'seo_article', step: 'profile', state: {}, status: 'queued', run_at: nowIso(), step_attempts: 0, repairs: [], lock_until: new Date(clock + 60000).toISOString() };
  db.agent_jobs.push(locked);
  r = await runner.runJob(sb, locked, deps);
  check('a job another run holds is not run twice', r.ran === false && locked.status === 'queued');
  locked.status = 'cancelled';
  const orphan = { id: uuid(), user_id: OWNER, agent: 'x', kind: 'nope', step: 'a', state: {}, status: 'queued', run_at: nowIso(), step_attempts: 0, repairs: [], lock_until: null };
  db.agent_jobs.push(orphan);
  await runner.runJob(sb, orphan, deps);
  check('a job no agent handles fails with a reason (not a crash loop)', orphan.status === 'failed' && /No handler/.test(orphan.last_error));
  ap.connection_id = conn.id; conn.status = 'needs_attention';
  ap.next_run_at = new Date(clock - 1000).toISOString();
  t = await tick();
  check('a due run whose connection needs reconnecting pauses, and says why', t.scheduled === 0 && /Waiting for WordPress — example.com to be reconnected/.test(ap.paused_reason));
  conn.status = 'active';

  console.log('\n──── What happened (the inbox) ────');
  r = await api(activityApi, OWNER, { action: 'list', intelProfileId: PROFILE });
  check('lists the business\'s events, newest first, with how many need you', r.statusCode === 200 && r.body.events.length === db.activity_events.length && typeof r.body.needsYou === 'number');
  r = await api(activityApi, STRANGER, { action: 'list', intelProfileId: PROFILE });
  check('an outsider can\'t read it', r.statusCode === 403);
  const someId = db.activity_events[0].id;
  r = await api(activityApi, STRANGER, { action: 'read', ids: [someId] });
  check('…or mark it read', r.body.updated === 0 && !db.activity_events[0].read_at);
  r = await api(activityApi, OWNER, { action: 'dismiss', id: lastEvent('info').id });
  check('a note can be dismissed', r.body.updated === 1 && lastEvent('info').resolved_at);
  const activity = require(path.join(REPO, 'api/_lib/autopilot/activity.js'));
  const n0 = emails.length;
  await activity.record(sb, { user_id: OWNER, kind: 'failed', title: 'Same problem' }, deps);
  await activity.record(sb, { user_id: OWNER, kind: 'failed', title: 'Same problem' }, deps);
  check('the same alert is emailed once, not every five minutes', emails.length === n0 + 1);
  check('email text is escaped', (await activity.record(sb, { user_id: OWNER, kind: 'failed', title: '<img src=x onerror=alert(1)>' }, deps)) && emails.slice(-1)[0].body.html.includes('&lt;img'));

  r = await api(connectionsApi, OWNER, { action: 'disconnect', id: conn.id });
  check('disconnecting wipes the stored login and unhooks the autopilot', r.statusCode === 200 && conn.secret_enc === null && conn.status === 'disconnected' && ap.connection_id === null);
  cms.PROVIDERS.wordpress.verify = realVerify;

  console.log('\n──── the other agents on the same engine ────');
  process.env.ANTHROPIC_API_KEY = 'sk-test';
  r = await api(autopilotApi, OWNER, { action: 'agents', intelProfileId: PROFILE });
  check('every agent that can run on autopilot is listed (SEO, Analytics, CRO, Social)', r.statusCode === 200 && ['seo', 'analytics', 'cro', 'social'].every(a => r.body.agents.some(x => x.agent === a)) && r.body.agents.find(x => x.agent === 'seo').autopilot.id === ap.id);
  r = await api(autopilotApi, OWNER, { action: 'save', agent: 'analytics', intelProfileId: PROFILE, mode: 'auto', cadence: { days: [1], hour: 8, timezone: 'Australia/Sydney' }, settings: { periodDays: 30, focus: 'spring offer' } });
  const apA = db.autopilots.find(x => x.agent === 'analytics');
  check('draft-and-approve agents always ask, whatever mode is sent', r.statusCode === 200 && apA.mode === 'approve' && apA.settings.periodDays === 30 && apA.settings.focus === 'spring offer');
  let facts = { period: { label: 'the last 30 days' }, email: { available: true, campaignsSent: 0 }, audience: { available: true, totalContacts: 0 }, social: { available: false }, flows: { available: false }, revenue: { available: false } };
  const built = [];
  deps.gatherFacts = async (sbx, o) => { built.push(o); return facts; };
  deps.buildReport = async (f, o) => { built.push(o); return { title: 'Marketing report — last 30 days', markdown: '## Summary\n\n12 emails sent.', review: { approved: true } }; };
  await api(autopilotApi, OWNER, { action: 'runNow', id: apA.id });
  await tick();
  const jA1 = db.agent_jobs.filter(j => j.autopilot_id === apA.id)[0];
  check('Analytics: nothing happened → no report written, and the business is told why', jA1.status === 'done' && jA1.result.skipped === 'no_data' && built.length === 1 && built[0].userId === OWNER && built[0].periodDays === 30 && /No report this time/.test(lastEvent('info').title) && !db.mission_artifacts.length);
  facts = { ...facts, email: { available: true, campaignsSent: 12 } };
  await api(autopilotApi, OWNER, { action: 'runNow', id: apA.id });
  await tick();
  const artA = db.mission_artifacts[0];
  const askA = lastEvent('needs_approval');
  check('Analytics: the report is written from the facts and waits for approval as a mission artifact', artA && artA.kind === 'analytics_report' && artA.status === 'pending_approval' && artA.intel_profile_id === PROFILE && artA.payload.markdown.includes('12 emails') && built[2].focus === 'spring offer' && /Emergency plumbers/.test(built[2].businessContext));
  check('…and the inbox asks for a review of that artifact (emailed)', askA.action.type === 'artifact' && askA.action.artifactId === artA.id && /checked against your data/.test(askA.body) && emails.slice(-1)[0].body.subject.includes(artA.title));

  r = await api(autopilotApi, OWNER, { action: 'save', agent: 'cro', intelProfileId: PROFILE, cadence: { days: [3], hour: 9, timezone: 'UTC' }, settings: { urls: 'javascript:alert(1)\nhttps://example.com/book' } });
  const apC = db.autopilots.find(x => x.agent === 'cro');
  check('CRO: only real page addresses are kept', JSON.stringify(apC.settings.urls) === '["https://example.com/book"]' && apC.settings.goal === '');
  const crawled = [];
  let crawlFails = 1;
  deps.crawlSite = async (u) => { crawled.push(u); if (crawlFails-- > 0) throw new Error('fetch failed'); return { homepageHtml: '<h1>Book</h1>', pages: [] }; };
  deps.auditAndPropose = async (sites, o) => ({ ideas: [{ name: 'Move the booking form up', hypothesis: 'Because the form is below the fold…', what_to_change: 'Form position', primary_metric: 'Bookings' }], observations: [], droppedUnverified: 0, droppedForeignFigures: 0, _o: o });
  await api(autopilotApi, OWNER, { action: 'runNow', id: apC.id });
  await tick();
  const jC = db.agent_jobs.filter(j => j.autopilot_id === apC.id)[0];
  const askC = lastEvent('needs_permission');
  check('CRO: with no goal it doesn\'t guess — it asks for one and waits', jC.status === 'waiting_permission' && /needs your goal/.test(askC.title) && askC.action.type === 'settings' && askC.action.agent === 'cro' && !crawled.length);
  r = await api(autopilotApi, OWNER, { action: 'save', agent: 'cro', intelProfileId: PROFILE, cadence: { days: [3], hour: 9, timezone: 'UTC' }, settings: { goal: 'a booking', urls: 'https://example.com/book' } });
  check('…saving the goal picks the work back up and clears the request', jC.status === 'queued' && askC.resolved_at);
  await tick();
  check('…an unreadable page is retried later (not failed)', jC.status === 'queued' && jC.repairs.length === 1 && /website didn't answer/.test(jC.last_error));
  clock += 31 * 60000;
  await tick();
  const artC = db.mission_artifacts.find(x => x.kind === 'cro_plan');
  check('…then the tests are proposed and wait for approval', jC.status === 'done' && artC && artC.status === 'pending_approval' && artC.payload.params.goal === 'a booking' && lastEvent('needs_approval').action.artifactId === artC.id);
  check('…and the business is told a problem was fixed on the way', /CRO Lab fixed 1 problem/.test(lastEvent('repaired').title));

  r = await api(autopilotApi, OWNER, { action: 'save', agent: 'social', intelProfileId: PROFILE, cadence: { days: [1], hour: 9, timezone: 'UTC' }, settings: { topics: 'Blocked drains\nHot water', platforms: ['LinkedIn', 'MySpace'], postCount: 99 } });
  const apS = db.autopilots.find(x => x.agent === 'social');
  check('Social: settings cleaned (known networks only, at most 10 posts)', JSON.stringify(apS.settings.platforms) === '["LinkedIn"]' && apS.settings.postCount === 10);
  const gens = [];
  deps.generateSocialPosts = async (o) => { gens.push(o); return { contentPlanNote: 'note', posts: [{ platform: 'LinkedIn', title: 'T', body: `Post about ${o.topic}`, hashtags: ['#plumbing'] }, { platform: 'Facebook', body: 'not asked for' }] }; };
  for (let i = 0; i < 3; i++) { await api(autopilotApi, OWNER, { action: 'runNow', id: apS.id }); await tick(); }
  check('Social: works through the topics in turn', JSON.stringify(gens.map(g => g.topic)) === '["Blocked drains","Hot water","Blocked drains"]');
  const artS = db.mission_artifacts.filter(x => x.kind === 'social_posts');
  check('…drafts are cleaned to the chosen networks and wait for approval (nothing posted)', artS.length === 3 && artS[0].payload.posts.length === 1 && artS[0].payload.posts[0].hashtags[0] === 'plumbing' && artS.every(x => x.status === 'pending_approval') && /schedules them one a day at 10:00, posted through your own signed-in accounts/.test(lastEvent('needs_approval').body) && artS[0].payload.autoSchedule.hour === 10 && artS[0].payload.autoSchedule.timezone === 'UTC');
  delete process.env.ANTHROPIC_API_KEY;
  await api(autopilotApi, OWNER, { action: 'runNow', id: apS.id });
  await tick();
  const jNoKey = db.agent_jobs.filter(j => j.autopilot_id === apS.id).slice(-1)[0];
  check('a missing AI key fails at once, says so plainly, and alerts the Audema team', jNoKey.status === 'failed' && /missing a setting/.test(lastEvent('failed').body));
  process.env.ANTHROPIC_API_KEY = 'sk-test';
  const ma = read('api/mission-artifacts.js');
  check('approving or rejecting an artifact clears its "Ready for your OK" in the inbox', /activity_events\?kind=eq\.needs_approval&resolved_at=is\.null&action->>artifactId=eq\.\$\{artifact\.id\}/.test(ma));

  console.log('\n──── background jobs report what they did ────');
  const notify = require(path.join(REPO, 'api/_lib/autopilot/notify.js'));
  const sweep = { id: uuid(), user_id: OWNER, intel_profile_id: PROFILE, name: 'Texas — plumbers', write_to_tracker: true, totals: {} };
  await notify.sweepResult(sb, sweep, { ran: true, status: 'running' }, deps);
  const nBefore = db.activity_events.length;
  check('a sweep still running says nothing', db.activity_events.length === nBefore);
  await notify.sweepResult(sb, sweep, { ran: true, status: 'paused', note: 'Google Places refused (quota exceeded).', totals: { searched: 40, qualified: 6, written: 5 } }, deps);
  const sw = lastEvent('needs_permission');
  check('Blade: a sweep paused by Google\'s quota asks the business, with the counts so far', sw && sw.agent === 'blade' && /paused the Texas — plumbers sweep/.test(sw.title) && /40 towns searched · 6 businesses qualified · 5 added to the tracker/.test(sw.body) && sw.action.href === '/agents/blade-sweeps.html');
  await notify.sweepResult(sb, sweep, { ran: true, status: 'paused', note: 'Google Places refused (quota exceeded).', totals: {} }, deps);
  check('…said once, not every five minutes', db.activity_events.filter(e => e.title === sw.title).length === 1);
  await notify.sweepResult(sb, sweep, { ran: true, status: 'done', totals: { searched: 120, qualified: 14, written: 12 } }, deps);
  check('…and when it finishes', /Blade finished sweeping/.test(lastEvent('done').title));
  await notify.competitorChanged(sb, { user_id: OWNER, name: 'Rival Plumbing', url: 'https://rival.example/pricing' }, [{ change_type: 'title', previous_value: 'From $99', new_value: 'From $79' }, { change_type: 'content' }], deps);
  const cw = lastEvent('info');
  check('Competitor watch: a change is reported with what changed', /Rival Plumbing changed their page/.test(cw.title) && /"From \$99" → "From \$79"/.test(cw.body) && /wording changed/.test(cw.body) && cw.intel_profile_id === null);
  r = await api(activityApi, OWNER, { action: 'list', intelProfileId: PROFILE });
  check('…and shows in the owner\'s inbox even though it isn\'t tied to a business', r.body.events.some(e => e.id === cw.id));
  r = await api(activityApi, TEAMMATE, { action: 'list', intelProfileId: PROFILE });
  check('…but not in a teammate\'s (it is the owner\'s own watch)', r.statusCode === 200 && !r.body.events.some(e => e.id === cw.id) && r.body.events.some(e => e.id === sw.id));
  const post = { id: uuid(), user_id: OWNER, intel_profile_id: PROFILE, platform: 'LinkedIn', headline: 'Spring offer' };
  await notify.postFailed(sb, post, { success: false, status: 'not_connected', error: 'LinkedIn is not connected' }, deps);
  await notify.postFailed(sb, post, { success: false, status: 'not_connected' }, deps);
  check('Scheduled posts: a network that isn\'t connected is one request, not one per post', db.activity_events.filter(e => /LinkedIn isn't connected/.test(e.title)).length === 1 && lastEvent('needs_permission').agent === 'social');
  await notify.postFailed(sb, post, { success: false, status: 'failed', error: 'Text too long' }, deps);
  check('…a real failure says what went wrong and that nothing was posted', /Text too long\. Nothing was posted/.test(lastEvent('failed').body));
  await notify.flowSendFailed(sb, { userId: OWNER, flowName: 'Welcome', outcome: 'no_from_address' }, deps);
  await notify.flowSendFailed(sb, { userId: OWNER, flowName: 'Welcome', outcome: 'no_from_address' }, deps);
  await notify.flowSendFailed(sb, { userId: OWNER, flowName: 'Welcome', outcome: 'sent' }, deps);
  check('Email flows: a step that can\'t send says how to fix it, once', db.activity_events.filter(e => /"Welcome" couldn't send/.test(e.title)).length === 1 && /no "from" address/.test(lastEvent('failed').body));
  check('a report that can\'t be written never stops the job', (await notify.postFailed(async () => { throw new Error('db down'); }, post, { status: 'x' }, deps)) === null);
  for (const [file, fn] of [['api/cron-blade-sweeps.js', 'sweepResult'], ['api/cron-competitor-watch.js', 'competitorChanged'], ['api/cron-auto-publish.js', 'postFailed'], ['api/cron-email-flows.js', 'flowSendFailed']]) {
    check(`${file} reports to What happened`, read(file).includes(`notify.${fn}(`));
  }
  check('every email-flow failure the business can fix is reported', ['no_from_address', 'copy_not_sendable', 'send_failed', 'send_error'].every(o => read('api/cron-email-flows.js').includes(`outcome: '${o}', detail`)));

  console.log('\n──── sign in with LinkedIn, Facebook, X, Google ────');
  const oauth = require(path.join(REPO, 'api/_lib/oauth.js'));
  const oauthApi = require(path.join(REPO, 'api/oauth.js'));
  for (const k of ['LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET', 'FACEBOOK_APP_ID', 'FACEBOOK_APP_SECRET', 'X_CLIENT_ID', 'X_CLIENT_SECRET', 'GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET']) delete process.env[k];
  r = await api(connectionsApi, OWNER, { action: 'providers' });
  check('sign-in accounts are listed, each saying whether this Audema has it set up', ['linkedin', 'facebook', 'x', 'gsc'].every(id => r.body.signIn.some(p => p.id === id && p.configured === false)));
  r = await api(oauthApi, OWNER, { action: 'start', provider: 'x', intelProfileId: PROFILE });
  check('starting a network that isn\'t set up says which settings are missing', r.statusCode === 503 && /X_CLIENT_ID/.test(r.body.error));
  Object.assign(process.env, { X_CLIENT_ID: 'xid', X_CLIENT_SECRET: 'xsec', FACEBOOK_APP_ID: 'fid', FACEBOOK_APP_SECRET: 'fsec', LINKEDIN_CLIENT_ID: 'lid', LINKEDIN_CLIENT_SECRET: 'lsec', GOOGLE_OAUTH_CLIENT_ID: 'gid', GOOGLE_OAUTH_CLIENT_SECRET: 'gsec' });
  r = await api(oauthApi, STRANGER, { action: 'start', provider: 'x', intelProfileId: PROFILE });
  check('an outsider can\'t start connecting the business\'s accounts', r.statusCode === 403);
  r = await api(oauthApi, OWNER, { action: 'start', provider: 'x', intelProfileId: PROFILE });
  const xUrl = new URL(r.body.url);
  const xState = oauth.openState(xUrl.searchParams.get('state'));
  check('X: sent to X\'s consent screen with PKCE, the right scopes and our callback', xUrl.origin === 'https://x.com' && xUrl.searchParams.get('code_challenge_method') === 'S256' && /tweet\.write/.test(xUrl.searchParams.get('scope')) && /offline\.access/.test(xUrl.searchParams.get('scope')) && xUrl.searchParams.get('redirect_uri') === 'https://app.example/api/oauth');
  check('…the state is sealed (unreadable, holds the business and the PKCE verifier)', !xUrl.searchParams.get('state').includes(PROFILE) && xState.intel_profile_id === PROFILE && xState.ownerId === OWNER && xState.verifier && require('crypto').createHash('sha256').update(xState.verifier).digest('base64url') === xUrl.searchParams.get('code_challenge'));
  check('…and expires', oauth.openState(xUrl.searchParams.get('state'), Date.now() + 16 * 60000) === null && oauth.openState('v1.forged.state.x') === null);

  const oreqs = [];
  const oFetch = (routes) => async (url, init = {}) => { oreqs.push({ url, init }); for (const [re, rr] of routes) if (re.test(url)) return rr; return resp(404, { error: 'no route' }); };
  const realFetch = global.fetch;
  global.fetch = oFetch([[/api\.x\.com\/2\/oauth2\/token/, resp(200, { access_token: 'xat', refresh_token: 'xrt', expires_in: 7200 })], [/api\.x\.com\/2\/users\/me/, resp(200, { data: { id: '42', username: 'acmeplumbing' } })]]);
  const getRes = mkRes(); getRes.end = function () { this.ended = true; return this; };
  await oauthApi({ method: 'GET', headers: {}, query: { code: 'c0de', state: xUrl.searchParams.get('state') } }, getRes);
  const xConn = db.connections.find(c => c.provider === 'x');
  const tokenReq = oreqs.find(q => /oauth2\/token/.test(q.url));
  check('callback: code swapped with the verifier and client auth, account saved encrypted under the business', xConn && xConn.intel_profile_id === PROFILE && xConn.user_id === OWNER && xConn.label === 'X — @acmeplumbing' && box.open(xConn.secret_enc).refreshToken === 'xrt' && new URLSearchParams(tokenReq.init.body).get('code_verifier') === xState.verifier && tokenReq.init.headers.Authorization.startsWith('Basic '));
  check('…and the browser goes back to Connections saying so', getRes.statusCode === 302 && /\/connections\.html\?connected=X/.test(getRes.headers.Location));
  const bad = mkRes(); bad.end = function () { return this; };
  await oauthApi({ method: 'GET', headers: {}, query: { code: 'c', state: 'v1.tampered.state.value' } }, bad);
  check('a forged or stale state connects nothing', /oauth_error=/.test(bad.headers.Location) && db.connections.filter(c => c.provider === 'x').length === 1);
  const cancel = mkRes(); cancel.end = function () { return this; };
  const st2 = (await api(oauthApi, OWNER, { action: 'start', provider: 'x', intelProfileId: PROFILE })).body.url;
  await oauthApi({ method: 'GET', headers: {}, query: { error: 'access_denied', state: new URL(st2).searchParams.get('state') } }, cancel);
  check('cancelling the sign-in says nothing was connected', /cancelled/.test(decodeURIComponent(cancel.headers.Location)));

  const fbStart = new URL((await api(oauthApi, OWNER, { action: 'start', provider: 'facebook', intelProfileId: PROFILE })).body.url);
  check('Facebook: asks only for Page posting, never the personal profile', /pages_manage_posts/.test(fbStart.searchParams.get('scope')) && !/publish_actions|user_posts/.test(fbStart.searchParams.get('scope')));
  global.fetch = oFetch([[/oauth\/access_token\?.*fb_exchange_token/, resp(200, { access_token: 'long' })], [/oauth\/access_token/, resp(200, { access_token: 'short' })], [/me\/accounts/, resp(200, { data: [{ id: 'p1', name: 'Acme Plumbing', access_token: 'pt1', tasks: ['CREATE_CONTENT'] }, { id: 'p2', name: 'Acme Gas', access_token: 'pt2', tasks: ['CREATE_CONTENT'] }, { id: 'p3', name: 'Read only', access_token: 'pt3', tasks: ['ANALYZE'] }] })]]);
  const fbRes = mkRes(); fbRes.end = function () { return this; };
  await oauthApi({ method: 'GET', headers: {}, query: { code: 'c', state: fbStart.searchParams.get('state') } }, fbRes);
  const fbConn = db.connections.find(c => c.provider === 'facebook');
  check('Facebook: only Pages it may post to are offered; long-lived Page tokens kept encrypted', fbConn && fbConn.config.pages.length === 2 && fbConn.config.pageId === 'p1' && box.open(fbConn.secret_enc).pageTokens.p2 === 'pt2' && !JSON.stringify(fbConn.config).includes('pt1'));
  r = await api(connectionsApi, OWNER, { action: 'list', intelProfileId: PROFILE });
  const fbView = r.body.connections.find(c => c.provider === 'facebook');
  check('…the business can choose which Page (the list never carries a token)', fbView.choice.options.length === 2 && !JSON.stringify(r.body).includes('pt1'));
  r = await api(connectionsApi, OWNER, { action: 'choose', id: fbConn.id, value: 'p3' });
  check('…but not a Page the sign-in can\'t post to', r.statusCode === 400 && fbConn.config.pageId === 'p1');
  r = await api(connectionsApi, OWNER, { action: 'choose', id: fbConn.id, value: 'p2' });
  check('…choosing one switches the label too', r.statusCode === 200 && fbConn.config.pageId === 'p2' && fbConn.label === 'Facebook — Acme Gas');

  console.log('\n──── publishing through the business\'s own accounts ────');
  const sp = require(path.join(REPO, 'api/_lib/social-publish.js'));
  db.social_posts = [];
  const mkPost = (o) => { const p = { id: uuid(), user_id: OWNER, intel_profile_id: PROFILE, project_id: null, status: 'scheduled', publish_status: 'queued', scheduled_at: new Date(Date.now() - 60000).toISOString(), metadata: {}, hashtags: [], ...o }; db.social_posts.push(p); return p; };
  check('a post finds its business\'s connection for that network', (await sp.findConnection(sb, { platform: 'Twitter/X', intel_profile_id: PROFILE })).id === xConn.id && (await sp.findConnection(sb, { platform: 'Twitter/X', intel_profile_id: uuid() })) === null);
  const longPost = { platform: 'Twitter/X', body: 'x'.repeat(300) };
  threw = null; try { await sp.publishVia(sb, { ...xConn, secret: box.open(xConn.secret_enc) }, longPost); } catch (e) { threw = e; }
  check('a post too long for X is refused with the reason, never cut short', threw && threw.kind === 'permanent' && /300 characters; X allows 280/.test(threw.message));
  global.fetch = oFetch([[/api\.x\.com\/2\/oauth2\/token/, resp(200, { access_token: 'xat2', refresh_token: 'xrt2', expires_in: 7200 })], [/api\.x\.com\/2\/tweets/, resp(201, { data: { id: '999' } })]]);
  const xc = { ...xConn, secret: { ...box.open(xConn.secret_enc), expiresAt: new Date(Date.now() + 60000).toISOString() } };
  oreqs.length = 0;
  const outX = await sp.publishVia(sb, xc, { platform: 'Twitter/X', body: 'Hot water out? We can help.', hashtags: ['#plumbing'] });
  check('an expiring token is refreshed first and the new one saved (X rotates refresh tokens)', oreqs[0].url.includes('oauth2/token') && box.open(xConn.secret_enc).refreshToken === 'xrt2');
  check('…then the post goes out with its hashtags, and the real link comes back', outX.url === 'https://x.com/i/web/status/999' && JSON.parse(oreqs[1].init.body).text === 'Hot water out? We can help.\n\n#plumbing');

  const autoPub = require(path.join(REPO, 'api/cron-auto-publish.js'));
  process.env.CRON_SECRET = 'cron';
  const runCron = async () => { const rr = mkRes(); await autoPub({ method: 'GET', headers: { authorization: 'Bearer cron' } }, rr); return rr.body; };
  // cron-auto-publish talks to Supabase over fetch: route it to the in-memory db.
  const dbFetch = (extra = []) => async (url, init = {}) => {
    if (url.startsWith('https://db.example/rest/v1')) { const out = await sb(init.method || 'GET', url.slice('https://db.example/rest/v1'.length), init.body ? JSON.parse(init.body) : undefined); return { ok: out.ok, status: out.status, json: async () => out.data, text: async () => JSON.stringify(out.data) }; }
    oreqs.push({ url, init });
    for (const [re, rr] of extra) if (re.test(url)) return typeof rr === 'function' ? rr() : rr;
    return resp(404, {});
  };
  const pOk = mkPost({ platform: 'Twitter/X', body: 'Scheduled post' });
  global.fetch = dbFetch([[/api\.x\.com\/2\/tweets/, resp(201, { data: { id: '1001' } })]]);
  let cronOut = await runCron();
  check('the scheduled-post cron publishes through the business\'s own X account', pOk.status === 'published' && pOk.publish_status === 'published' && pOk.publish_platform_post_id === '1001' && cronOut.published === 1);
  const pHiccup = mkPost({ platform: 'Twitter/X', body: 'Hiccup post' });
  global.fetch = dbFetch([[/api\.x\.com\/2\/tweets/, resp(503, { title: 'Service Unavailable' })]]);
  await runCron();
  check('a hiccup puts it back in the queue a little later, counted (not failed)', pHiccup.publish_status === 'queued' && pHiccup.metadata.publish_attempts === 1 && Date.parse(pHiccup.scheduled_at) > Date.now() + 60000);
  pHiccup.scheduled_at = new Date(Date.now() - 1000).toISOString();
  global.fetch = dbFetch([[/api\.x\.com\/2\/tweets/, resp(401, { title: 'Unauthorized' })]]);
  await runCron();
  check('a refused sign-in: post waits, connection flagged, business asked to sign in again', pHiccup.publish_status === 'not_connected' && xConn.status === 'needs_attention' && /Sign in to X — @acmeplumbing again/.test(lastEvent('needs_permission').title) && lastEvent('needs_permission').action.connectionId === xConn.id);
  const reStart = await api(oauthApi, OWNER, { action: 'start', provider: 'x', connectionId: xConn.id });
  global.fetch = oFetch([[/api\.x\.com\/2\/oauth2\/token/, resp(200, { access_token: 'xat3', refresh_token: 'xrt3', expires_in: 7200 })], [/api\.x\.com\/2\/users\/me/, resp(200, { data: { id: '42', username: 'acmeplumbing' } })]]);
  global.fetch = ((inner) => async (url, init) => (url.startsWith('https://db.example') ? dbFetch()(url, init) : inner(url, init)))(global.fetch);
  const reRes = mkRes(); reRes.end = function () { return this; };
  await oauthApi({ method: 'GET', headers: {}, query: { code: 'c', state: new URL(reStart.body.url).searchParams.get('state') } }, reRes);
  check('signing in again fixes the connection, clears the request, and re-queues the waiting post', xConn.status === 'active' && box.open(xConn.secret_enc).accessToken === 'xat3' && pHiccup.publish_status === 'queued' && lastEvent('needs_permission').resolved_at && db.connections.filter(c => c.provider === 'x').length === 1);
  global.fetch = realFetch;

  const { spreadSlots } = require(path.join(REPO, 'api/_lib/autopilot/schedule.js'));
  const slots = spreadSlots(3, { hour: 10, timezone: 'Australia/Sydney' }, new Date('2026-11-23T01:00:00Z'));
  check('approved posts are spread one a day at the business\'s hour, starting tomorrow', JSON.stringify(slots.map(d => d.toISOString())) === JSON.stringify(['2026-11-23T23:00:00.000Z', '2026-11-24T23:00:00.000Z', '2026-11-25T23:00:00.000Z']));
  check('approving an autopilot\'s posts queues them for publishing (Social Studio and Nancy)', (ma.match(/applyAutoSchedule\(rows, payload\.autoSchedule/g) || []).length === 2 && /status: 'scheduled', publish_status: 'queued'/.test(read('api/mission-artifacts.js')));

  console.log('\n──── Search Console: sign in, report, act ────');
  const gscLib = require(path.join(REPO, 'api/_lib/gsc.js'));
  const gStart = new URL((await api(oauthApi, OWNER, { action: 'start', provider: 'gsc', intelProfileId: PROFILE })).body.url);
  check('Google: read-only Search Console access, offline (so it keeps working), our callback', gStart.origin === 'https://accounts.google.com' && gStart.searchParams.get('scope') === 'https://www.googleapis.com/auth/webmasters.readonly' && gStart.searchParams.get('access_type') === 'offline' && gStart.searchParams.get('prompt') === 'consent');
  check('…and it remembers the business\'s website to pick the right property', oauth.openState(gStart.searchParams.get('state')).siteUrl === 'https://example.com');
  global.fetch = oFetch([[/oauth2\.googleapis\.com\/token/, resp(200, { access_token: 'gat', expires_in: 3600 })]]);
  const gNo = mkRes(); gNo.end = function () { return this; };
  await oauthApi({ method: 'GET', headers: {}, query: { code: 'c', state: gStart.searchParams.get('state') } }, gNo);
  check('Google without lasting access is refused with how to fix it (nothing saved)', /lasting access/.test(new URLSearchParams(gNo.headers.Location.split('?')[1]).get('oauth_error')) && !db.connections.some(c => c.provider === 'gsc'));
  const gStart2 = new URL((await api(oauthApi, OWNER, { action: 'start', provider: 'gsc', intelProfileId: PROFILE })).body.url);
  global.fetch = oFetch([[/oauth2\.googleapis\.com\/token/, resp(200, { access_token: 'gat', refresh_token: 'grt', expires_in: 3600 })], [/webmasters\/v3\/sites$/, resp(200, { siteEntry: [{ siteUrl: 'https://other.example/', permissionLevel: 'siteOwner' }, { siteUrl: 'sc-domain:example.com', permissionLevel: 'siteFullUser' }, { siteUrl: 'https://unverified.example/', permissionLevel: 'siteUnverifiedUser' }] })]]);
  const gRes = mkRes(); gRes.end = function () { return this; };
  await oauthApi({ method: 'GET', headers: {}, query: { code: 'c', state: gStart2.searchParams.get('state') } }, gRes);
  const gConn = db.connections.find(c => c.provider === 'gsc');
  check('…the matching property is chosen (domain property for the business\'s site); unverified ones left out', gConn && gConn.config.property === 'sc-domain:example.com' && gConn.config.properties.length === 2 && gConn.label === 'Search Console — example.com');
  global.fetch = realFetch;

  const gq = [];
  const gNow = Date.parse('2026-11-23T00:00:00Z');
  global.fetch = async (url, init) => { gq.push({ url, body: JSON.parse(init.body) }); return resp(200, { rows: [{ keys: ['https://example.com/a'], clicks: 5, impressions: 100, ctr: 0.05, position: 7.25 }] }); };
  const perf = await gscLib.performance(sb, { ...gConn, secret: box.open(gConn.secret_enc) }, { days: 28, endOffsetDays: 3, now: gNow }, { now: () => gNow });
  check('Search Console is asked for final data ending 3 days ago (its numbers lag), for the chosen property', gq[0].url.includes(encodeURIComponent('sc-domain:example.com')) && gq[0].body.endDate === '2026-11-20' && gq[0].body.startDate === '2026-10-24' && gq[0].body.dataState === 'final' && perf.rows[0].ctr === 5 && perf.rows[0].position === 7.3);
  global.fetch = realFetch;
  const sd = gscLib.strikingDistance([{ query: 'blocked drain cost sydney', position: 11.2, impressions: 80 }, { query: 'hot water repair', position: 12, impressions: 300 }, { query: 'plumber', position: 9, impressions: 900 }, { query: 'gas fitter near me', position: 3, impressions: 500 }, { query: 'leaking tap fix', position: 15, impressions: 5 }], { covered: ['Hot water repair'] });
  check('nearly-ranking searches: page 1–2, real impressions, not already covered, not one-word', sd.length === 1 && sd[0].query === 'blocked drain cost sydney');

  // The SEO autopilot publishes to a live WordPress site again.
  const wp2 = { id: uuid(), user_id: OWNER, intel_profile_id: PROFILE, provider: 'wordpress', label: 'WordPress — example.com', site_url: 'https://example.com', config: {}, secret_enc: box.seal({ username: 'sam', appPassword: 'pw' }), status: 'active' };
  db.connections.push(wp2);
  Object.assign(ap, { connection_id: wp2.id, enabled: true });
  Object.assign(a1, { connection_id: wp2.id, remote_id: '1', refreshed_at: null });
  const updates = [];
  wpMock.update = async (c, remoteId, post) => { updates.push({ c, remoteId, post }); return { url: a1.published_url, remoteId }; };
  const covered = db.seo_topics.find(t => t.topic === 'Hot water system repair');
  deps.gsc = {
    performance: async (sbx, c, o) => {
      if (o.dimension === 'query') return { startDate: '2026-10-27', endDate: '2026-11-23', totals: {}, rows: [{ query: 'blocked drain cost sydney', clicks: 1, impressions: 80, ctr: 1, position: 11.2 }, { query: covered.target_keyword, clicks: 3, impressions: 300, ctr: 1, position: 12 }] };
      return o.endOffsetDays === 3
        ? { startDate: '2026-10-27', endDate: '2026-11-23', totals: { clicks: 120, impressions: 4000, ctr: 3, position: 14.2 }, rows: [{ page: a1.published_url + '/', clicks: 10, impressions: 400, ctr: 2.5, position: 9.4 }, { page: 'https://example.com/services', clicks: 60, impressions: 900, ctr: 6.7, position: 4.1 }] }
        : { startDate: '2026-09-29', endDate: '2026-10-26', totals: { clicks: 100, impressions: 3500, ctr: 2.9, position: 15 }, rows: [{ page: a1.published_url, clicks: 25, impressions: 380, ctr: 6.6, position: 4.2 }, { page: 'https://example.com/services', clicks: 50, impressions: 800, ctr: 6.2, position: 6.0 }] };
    },
  };
  r = await api(autopilotApi, OWNER, { action: 'save', agent: 'search', intelProfileId: PROFILE, mode: 'approve', cadence: { days: [1], hour: 7, timezone: 'UTC' }, settings: {} });
  const apG = db.autopilots.find(x => x.agent === 'search');
  check('the Search report just reports (no approval mode), adding topics and refreshing by default', apG.mode === 'auto' && apG.settings.addTopics === true && apG.settings.refreshSlipping === true);
  const topicsBefore = db.seo_topics.length;
  await api(autopilotApi, OWNER, { action: 'runNow', id: apG.id });
  await tick();
  const repJob = db.agent_jobs.filter(j => j.autopilot_id === apG.id)[0];
  const repEv = lastEvent('done');
  check('it saves what Search Console said', db.search_snapshots && db.search_snapshots.length === 1 && db.search_snapshots[0].property === 'sc-domain:example.com' && db.search_snapshots[0].totals.clicks === 120);
  check('the report: clicks and change, what climbed, what slipped', repJob.status === 'done' && /Search report: 120 clicks in 28 days \(\+20%\)/.test(repEv.title) && /\/services: position 6 → 4\.1/.test(repEv.body) && /\/emergency-plumber-sydney\/?: position 4\.2 → 9\.4/.test(repEv.body));
  const newTopic = db.seo_topics.slice(topicsBefore);
  check('a search it nearly ranks for goes into SEO Autopilot\'s plan, labelled as from Search Console (covered ones skipped)', newTopic.length === 1 && newTopic[0].topic === 'blocked drain cost sydney' && newTopic[0].data_source === 'search_console' && /position 11\.2 for "blocked drain cost sydney" \(80 impressions/.test(newTopic[0].rationale) && /Added to SEO Autopilot's plan/.test(repEv.body));
  const refJob = db.agent_jobs.find(j => j.kind === 'seo_refresh');
  check('the slipping article is queued for a refresh, and the report says so', refJob && refJob.state.articleId === a1.id && refJob.autopilot_id === ap.id && /slipped 5\.2 places/.test(repEv.body));
  await tick();
  const refAsk = lastEvent('needs_approval');
  check('the refresh is rewritten and checked, then always asks (it changes a live page)', refJob.status === 'waiting_approval' && refAsk.action.refresh === true && /position 4\.2 → 9\.4/.test(refAsk.body) && /updates the same post/.test(refAsk.body) && !updates.length);
  r = await api(autopilotApi, OWNER, { action: 'article', jobId: refJob.id });
  check('the rewrite can be read before deciding (the live article is untouched until then)', r.statusCode === 200 && r.body.article.html.includes('<p>') && a1.title === 'Emergency plumber in Sydney: what to do first');
  const trustBefore = ap.trust_earned;
  await api(autopilotApi, OWNER, { action: 'approve', jobId: refJob.id });
  await tick();
  check('approving updates the same post on the website (never a second copy)', updates.length === 1 && updates[0].remoteId === '1' && calls.publish.length === 6 && refJob.status === 'done');
  check('…the article record is updated and dated, and refreshes don\'t count toward publishing on its own', a1.refreshed_at && a1.body_markdown === refJob.state.article.body_markdown && ap.trust_earned === trustBefore && /Refreshed on WordPress/.test(lastEvent('done').title));
  await api(autopilotApi, OWNER, { action: 'runNow', id: apG.id });
  await tick();
  check('a just-refreshed article isn\'t refreshed again straight away', db.agent_jobs.filter(j => j.kind === 'seo_refresh').length === 1);
  const gscConnRow = db.connections.find(c => c.provider === 'gsc'); gscConnRow.status = 'disconnected';
  await api(autopilotApi, OWNER, { action: 'runNow', id: apG.id });
  await tick();
  check('with no Search Console connected it asks for one and waits', /needs your Search Console/.test(lastEvent('needs_permission').title) && lastEvent('needs_permission').action.provider === 'gsc');
  delete deps.gsc;

  console.log('\n──── Site fixes: titles, descriptions, alt text ────');
  const pf = require(path.join(REPO, 'api/_lib/page-fixes.js'));
  const pageHtml = '<html><head><title>Home</title></head><body><h1>Emergency plumbers in Sydney</h1><p>We fix burst pipes 24/7 across Sydney. Call 0400 000 000.</p><img src="/wp-content/uploads/2026/05/van-1024x768.jpg" width="800"><img src="/logo.svg"><img src="/team.jpg" alt=""><img src="data:image/png;base64,xx"><img src="/pixel.gif" width="1"></body></html>';
  const sp1 = pf.scanPage(pageHtml, 'https://example.com/');
  check('scan: a short title, a missing description, and one real image with no alt (decorative alt="", icons, SVGs and data images left alone)', sp1.title === 'Home' && sp1.issues.map(i => i.type).join(',') === 'title,meta,alt' && sp1.issues[2].src === 'https://example.com/wp-content/uploads/2026/05/van-1024x768.jpg' && /burst pipes/.test(sp1.text));
  const prompts = [];
  const fakeClaude = async (o) => {
    prompts.push(o);
    if (o.tool.name === 'submit_page_fixes') return { success: true, data: { pages: [{ index: 0, title: 'Emergency Plumbers Sydney | 24/7 Burst Pipe Repairs', meta_description: 'Burst pipe or blocked drain? Our Sydney emergency plumbers fix it 24/7 — rated #1 by 500 customers. Call now for a fast, tidy repair.' }] } };
    return { success: true, data: { images: [{ index: 0, alt: 'Plumbing van parked outside a Sydney home' }] } };
  };
  let props = await pf.propose([sp1], { businessName: 'Acme Plumbing' }, { callClaude: fakeClaude });
  check('fixes are written from the page; a description that invents a figure ("500 customers") is dropped', props.length === 2 && props[0].type === 'title' && props[1].type === 'alt' && props.every(f => f.include && /^f\d+$/.test(f.id)));
  check('…the page text goes to the model fenced as untrusted, and alt text is written by looking at the image', /<untrusted|untrusted/i.test(prompts[0].user) && prompts[1].user.some(b => b.type === 'image' && b.source.url === sp1.issues[2].src));
  props = await pf.propose([sp1], { neverSay: ['24/7'] }, { callClaude: fakeClaude });
  check('…and a fix using a phrase the business never says is dropped', !props.some(f => f.type === 'title'));

  const apply = pf.makeApply(cms);
  const wpc = { site_url: 'https://example.com', config: {}, secret: { username: 'sam', appPassword: 'pw' } };
  reqs.length = 0;
  let ar = await apply.wordpress(wpc, { type: 'alt', page: 'https://example.com/', src: 'https://example.com/wp-content/uploads/2026/05/van-1024x768.jpg', value: 'Plumbing van' }, { fetch: fetchWith([[/media\?search=van/, resp(200, [{ id: 31, source_url: 'https://example.com/wp-content/uploads/2026/05/van.jpg' }])], [/media\/31$/, resp(200, { id: 31 })]]) });
  check('WordPress: alt text is set on the image in the media library (matched across its resized copies)', JSON.parse(reqs[1].init.body).alt_text === 'Plumbing van' && /media library/.test(ar.note));
  threw = null; try { await apply.wordpress(wpc, { type: 'meta', page: 'https://example.com/services/', value: 'x' }, { fetch: fetchWith([[/pages\?slug=services/, resp(200, [{ id: 5, link: 'https://example.com/services/' }])], [/rankmath/, resp(404, { code: 'rest_no_route' })]]) }); } catch (e) { threw = e; }
  check('WordPress without Rank Math: honestly handed over, saying why', threw && threw.kind === 'unsupported' && /Rank Math does; Yoast/.test(threw.message));
  reqs.length = 0;
  await apply.wordpress(wpc, { type: 'title', page: 'https://example.com/services/', value: 'Our services' }, { fetch: fetchWith([[/pages\?slug=services/, resp(200, [{ id: 5, link: 'https://example.com/services/' }])], [/rankmath/, resp(200, { ok: true })]]) });
  check('WordPress with Rank Math: the SEO title is set on the right page', JSON.parse(reqs.find(q => /rankmath/.test(q.url)).init.body).meta.rank_math_title === 'Our services' && JSON.parse(reqs.find(q => /rankmath/.test(q.url)).init.body).objectID === 5);
  reqs.length = 0;
  await apply.shopify(shopConn, { type: 'meta', page: 'https://shop.example/products/blue-tap', value: 'A blue tap' }, { fetch: fetchWith([[/products\.json\?handle=blue-tap/, resp(200, { products: [{ id: 77, images: [] }] })], [/products\/77\.json$/, resp(200, { product: { id: 77 } })]]) });
  check('Shopify: a product\'s search description is set', JSON.parse(reqs[1].init.body).product.metafields_global_description_tag === 'A blue tap');
  reqs.length = 0;
  await apply.shopify(shopConn, { type: 'alt', page: 'https://shop.example/products/blue-tap', src: 'https://cdn.shopify.com/s/files/1/blue-tap.jpg?v=1', value: 'Blue mixer tap' }, { fetch: fetchWith([[/products\.json\?handle=blue-tap/, resp(200, { products: [{ id: 77, images: [{ id: 9, src: 'https://cdn.shopify.com/s/files/1/blue-tap.jpg?v=2' }] }] })], [/images\/9\.json$/, resp(200, {})]]) });
  check('Shopify: product image alt text is set on that image', JSON.parse(reqs[1].init.body).image.alt === 'Blue mixer tap');
  threw = null; try { await apply.shopify(shopConn, { type: 'title', page: 'https://shop.example/', value: 'x' }); } catch (e) { threw = e; }
  check('Shopify home page: handed over, pointing to where it\'s set', threw && threw.kind === 'unsupported' && /Online Store → Preferences/.test(threw.message));
  reqs.length = 0;
  await apply.webflow({ site_url: 'https://acme.com', config: { siteId: 's1' }, secret: { token: 't' } }, { type: 'title', page: 'https://acme.com/about', value: 'About Acme' }, { fetch: fetchWith([[/sites\/s1\/pages/, resp(200, { pages: [{ id: 'pg1', slug: 'about' }] })], [/pages\/pg1$/, resp(200, {})]]) });
  check('Webflow: a static page\'s SEO title is set', reqs[1].init.method === 'PUT' && JSON.parse(reqs[1].init.body).seo.title === 'About Acme');
  threw = null; try { await apply.wix(); } catch (e) { threw = e; }
  check('Wix: says plainly it can\'t, so everything is handed over', threw && threw.kind === 'unsupported');

  r = await api(autopilotApi, OWNER, { action: 'save', agent: 'fixes', intelProfileId: PROFILE, connectionId: wp2.id, cadence: { days: [4], hour: 9, timezone: 'UTC' }, settings: { types: ['title', 'meta', 'alt'] } });
  const apF = db.autopilots.find(x => x.agent === 'fixes');
  check('Site fixes always asks (it changes live pages)', apF.mode === 'approve');
  deps.fetchText = async (u) => ({ status: 200, text: u === 'https://example.com/' ? pageHtml : '<html><head><title>Our plumbing services in Sydney and surrounds</title><meta name="description" content="Every plumbing service we offer across Sydney, from blocked drains and burst pipes to hot water systems and gas fitting."></head><body><h1>Services</h1></body></html>' });
  deps.callClaude = fakeClaude;
  const applied = []; let hiccup = true;
  deps.applyFixes = { wordpress: async (c, f) => { if (f.type === 'alt' && hiccup) { hiccup = false; throw Object.assign(new Error('WordPress had a server error (502)'), { kind: 'transient', status: 502 }); } if (f.type === 'title') { applied.push(f); return { note: 'Set in Rank Math.' }; } if (f.type === 'alt') { applied.push(f); return {}; } throw Object.assign(new Error('Your SEO plugin doesn\'t let other apps change titles'), { kind: 'unsupported' }); } };
  await api(autopilotApi, OWNER, { action: 'runNow', id: apF.id });
  await tick();
  const fj = db.agent_jobs.filter(j => j.autopilot_id === apF.id)[0];
  const fAsk = lastEvent('needs_approval');
  check('it reads the pages, writes fixes only where something is wrong, and asks', fj.status === 'waiting_approval' && fj.state.fixes.length === 2 && fAsk.action.type === 'fixes' && /2 fixes on 2 pages/.test(fAsk.title) && !applied.length);
  r = await api(autopilotApi, OWNER, { action: 'fixes', jobId: fj.id });
  check('the business can see each fix: page, problem, current and proposed value, image', r.statusCode === 200 && r.body.fixes.length === 2 && r.body.fixes[1].src && r.body.fixes[0].current === 'Home');
  r = await api(autopilotApi, STRANGER, { action: 'fixes', jobId: fj.id });
  check('…only the business can', r.statusCode === 404);
  r = await api(autopilotApi, OWNER, { action: 'approve', jobId: fj.id, edits: { fixes: [{ id: 'f1', include: false }, { id: 'f2', include: false }] } });
  check('approving with nothing ticked is refused (reject instead)', r.statusCode === 400 && fj.status === 'waiting_approval');
  r = await api(autopilotApi, OWNER, { action: 'approve', jobId: fj.id, edits: { fixes: [{ id: 'f1', include: true, value: 'Acme Plumbing | Emergency Plumbers Sydney' }] } });
  check('approving with an edit queues it with the edited value', r.statusCode === 200 && fj.state.fixes[0].value === 'Acme Plumbing | Emergency Plumbers Sydney' && fAsk.resolved_at);
  await tick();
  check('a hiccup mid-way keeps the fixes already made and retries the rest later', fj.status === 'queued' && fj.state.results.f1 && fj.state.results.f1.ok && !fj.state.results.f2 && applied.length === 1);
  clock += 3 * 60000;
  await tick();
  check('…the retry doesn\'t repeat a fix already made', fj.status === 'done' && applied.length === 2 && applied.filter(f => f.id === 'f1').length === 1);
  const fDone = lastEvent('done');
  check('…and the report lists what changed (and fixed a problem on the way)', /Site fixes: 2 applied/.test(fDone.title) && /Acme Plumbing \| Emergency Plumbers Sydney/.test(fDone.body) && /Site fixes fixed 1 problem/.test(lastEvent('repaired').title));
  delete deps.fetchText; delete deps.callClaude; delete deps.applyFixes;

  console.log('\n──── pages, cron, database ────');
  const vercel = JSON.parse(read('vercel.json'));
  check('the runner runs every 5 minutes', vercel.crons.some(c => c.path === '/api/cron-autopilot' && c.schedule === '1-59/5 * * * *'));
  const cron = read('api/cron-autopilot.js');
  check('the cron refuses to run without its secret', /CRON_SECRET is not configured/.test(cron) && /Unauthorized/.test(cron));
  const sql = read('supabase-autopilot.sql');
  check('the four tables have row-level security on and no browser policies', ['connections', 'autopilots', 'agent_jobs', 'activity_events'].every(tb => new RegExp(`ALTER TABLE ${tb}\\s+ENABLE ROW LEVEL SECURITY`).test(sql)) && !/CREATE POLICY/i.test(sql));
  check('the install-all file includes it', read('supabase-install-all.sql').includes('CREATE TABLE IF NOT EXISTS activity_events'));
  for (const pg of ['web/connections.html', 'web/seo/autopilot.html', 'web/inbox.html', 'web/autopilot.html']) {
    const src = read(pg);
    check(`${pg}: signed-in calls through the shared helper, nothing interpolated unescaped`, src.includes('/js/autopilot-ui.js') && src.includes('/js/send-auth.js') && !/\$\{(e|a|c|j|art|p|l|f)\.(title|body|label|provider|siteUrl|lastError|statusNote|keyword|help|name)\}/.test(src));
  }
  const inbox = read('web/inbox.html');
  check('inbox: links from events go through safeHref; reconnect goes to Connections', /safeHref\(a\.url\)/.test(inbox) && /connections\.html\?reconnect=/.test(inbox));
  const lh = inbox.match(/function localHref\(h\) \{[^\n]+\}/);
  const localHref = lh && new Function(`${lh[0]}; return localHref;`)();
  check('inbox: an event\'s link can only be one of our own pages', localHref && localHref('/agents/blade-sweeps.html') && !localHref('//evil.example/x') && !localHref('https://evil.example') && !localHref('javascript:alert(1)') && !localHref('/a"onmouseover=x'));
  check('inbox: mission artifacts are reviewed and decided through their own endpoint', /\/api\/mission-artifacts', \{ action: 'get'/.test(inbox) && /action: d\.aapprove \? 'approve' : 'reject'/.test(inbox));
  check('nav: the content engine and hub link to the new pages', read('web/seo/content-engine.html').includes('/seo/autopilot.html') && read('web/hub.html').includes('/inbox.html') && read('web/hub.html').includes('/autopilot.html'));

  console.log(`\n${failures ? `${failures} FAILED` : 'All passed'}`);
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
