/**
 * api/_lib/settings.js — the third-party keys and options Audema's agents use,
 * editable by admins instead of only in Vercel, so Audema can be sold to
 * other clients who bring their own.
 *
 * Where a key comes from, first match wins:
 *   1. the client's own (scope 'workspace': their Anthropic key, their email
 *      sender, their LinkedIn app…)
 *   2. the platform setting (scope 'platform': the defaults the platform admin
 *      set on the admin Settings page)
 *   3. the Vercel environment variable
 *
 * How the code sees it: every existing `process.env.X` read keeps working.
 * process.env is wrapped once so that, inside a request or a background job,
 * a key in CATALOG resolves through the current client's settings
 * (AsyncLocalStorage keeps concurrent requests apart). Keys outside CATALOG —
 * Supabase, CRON_SECRET, the encryption key, billing — always come from the
 * environment and can never be set here.
 *
 *   withRequest(req, fn)  every API handler (report-failure.js wraps them all):
 *                         the signed-in caller's client, else platform only
 *   runAs(userId, fn)     background work done for one account (autopilot
 *                         jobs, scheduled posts, email flows…)
 *   attachUser(userId)    a public endpoint that learns whose it is later
 *
 * Values are encrypted (secret-box) and never sent to a browser; admins see
 * only whether a key is set and its last four characters.
 *
 * Database lookups run on Vercel (or with APP_SETTINGS_DB=on); elsewhere this
 * is a pass-through to the environment.
 */

'use strict';

const { AsyncLocalStorage } = require('async_hooks');
const crypto = require('crypto');

const G = (group, items) => items.map(([key, label, opts = {}]) => ({ key, label, group, secret: opts.secret !== false, platformOnly: !!opts.platformOnly, help: opts.help || '' }));
const CATALOG = [
  ...G('AI models', [
    ['ANTHROPIC_API_KEY', 'Anthropic (Claude) API key', { help: 'Writes articles, reports, posts, campaigns and every agent\'s thinking.' }],
    ['OPENAI_API_KEY', 'OpenAI API key'],
    ['GEMINI_API_KEY', 'Google Gemini API key'],
    ['PERPLEXITY_API_KEY', 'Perplexity API key', { help: 'Live web research.' }],
    ['IMAGE_GEN_PROVIDER', 'Image generator', { secret: false, help: 'openai or gemini' }],
    ['IMAGE_GEN_API_KEY', 'Image generation API key'],
    ['OPENAI_IMAGE_MODEL', 'OpenAI image model', { secret: false }],
    ['GEMINI_IMAGE_MODEL', 'Gemini image model', { secret: false }],
    ['IMAGE_GEN_QUALITY', 'Image quality', { secret: false }],
    ['SEEDANCE_API_KEY', 'Seedance (video) API key'],
    ['ARK_API_KEY', 'BytePlus Ark API key'],
    ['SEEDANCE_MODEL', 'Seedance model', { secret: false }],
    ['SEEDANCE_API_BASE_URL', 'Seedance API address', { secret: false }],
  ]),
  ...G('Email sending', [
    ['RESEND_API_KEY', 'Resend API key', { help: 'Campaigns, flows and alert emails go out through this account.' }],
    ['RESEND_FROM_EMAIL', 'Sender email address', { secret: false, help: 'Must be on a domain verified in that Resend account.' }],
    ['RESEND_FROM_NAME', 'Sender name', { secret: false }],
    ['COMPLIANCE_COMPANY_NAME', 'Company name in email footers', { secret: false }],
    ['COMPLIANCE_MAILING_ADDRESS', 'Mailing address in email footers', { secret: false, help: 'Required by CAN-SPAM / GDPR / CASL.' }],
    ['COMPLIANCE_REPLY_TO', 'Reply-to address', { secret: false }],
    ['MAILCHIMP_API_KEY', 'Mailchimp API key'],
  ]),
  ...G('Sign-in apps (businesses connect their own accounts)', [
    ['LINKEDIN_CLIENT_ID', 'LinkedIn app client ID', { secret: false }],
    ['LINKEDIN_CLIENT_SECRET', 'LinkedIn app client secret'],
    ['FACEBOOK_APP_ID', 'Facebook app ID', { secret: false }],
    ['FACEBOOK_APP_SECRET', 'Facebook app secret'],
    ['FACEBOOK_GRAPH_VERSION', 'Facebook Graph API version', { secret: false }],
    ['X_CLIENT_ID', 'X app client ID', { secret: false }],
    ['X_CLIENT_SECRET', 'X app client secret'],
    ['GOOGLE_OAUTH_CLIENT_ID', 'Google OAuth client ID (Search Console)', { secret: false }],
    ['GOOGLE_OAUTH_CLIENT_SECRET', 'Google OAuth client secret'],
    ['APP_BASE_URL', 'App address', { secret: false, help: 'e.g. https://app.yourbrand.com — sign-ins return here and alert emails link here. Register <address>/api/oauth with each sign-in app.' }],
  ]),
  ...G('Single-account social posting (used when a business hasn\'t signed in)', [
    ['META_PAGE_ID', 'Facebook Page ID', { secret: false }],
    ['META_PAGE_ACCESS_TOKEN', 'Facebook Page access token'],
    ['LINKEDIN_ACCESS_TOKEN', 'LinkedIn company access token'],
    ['LINKEDIN_ORGANIZATION_URN', 'LinkedIn company URN', { secret: false }],
    ['LINKEDIN_PERSON_ACCESS_TOKEN', 'LinkedIn personal access token'],
    ['LINKEDIN_PERSON_URN', 'LinkedIn person URN', { secret: false }],
    ['TWITTER_USER_ACCESS_TOKEN', 'X user access token'],
    ['INSTAGRAM_USER_ID', 'Instagram user ID', { secret: false }],
    ['INSTAGRAM_ACCESS_TOKEN', 'Instagram access token'],
    ['TIKTOK_ACCESS_TOKEN', 'TikTok access token'],
  ]),
  ...G('SEO and research data', [
    ['DATAFORSEO_LOGIN', 'DataForSEO login', { secret: false }],
    ['DATAFORSEO_PASSWORD', 'DataForSEO password'],
    ['SEMRUSH_API_KEY', 'Semrush API key'],
    ['AHREFS_API_KEY', 'Ahrefs API key'],
    ['MOZ_ACCESS_ID', 'Moz access ID', { secret: false }],
    ['MOZ_API_KEY', 'Moz API key'],
    ['GOOGLE_PAGESPEED_API_KEY', 'Google PageSpeed API key'],
    ['BUILTWITH_API_KEY', 'BuiltWith API key'],
  ]),
  ...G('Leads and prospecting', [
    ['GOOGLE_PLACES_API_KEY', 'Google Places API key'],
    ['APOLLO_API_KEY', 'Apollo API key'],
    ['HUNTER_API_KEY', 'Hunter API key'],
    ['GEONAMES_USERNAME', 'GeoNames username', { secret: false }],
    ['GOOGLE_SERVICE_ACCOUNT_JSON', 'Google service account (JSON)', { help: 'For writing to Google Sheets.' }],
  ]),
  ...G('Images, screenshots and hosting', [
    ['R2_ACCOUNT_ID', 'Cloudflare R2 account ID', { secret: false }],
    ['R2_ACCESS_KEY_ID', 'R2 access key ID', { secret: false }],
    ['R2_SECRET_ACCESS_KEY', 'R2 secret access key'],
    ['R2_BUCKET_NAME', 'R2 bucket name', { secret: false }],
    ['R2_PUBLIC_BASE_URL', 'R2 public address', { secret: false }],
    ['UNSPLASH_ACCESS_KEY', 'Unsplash access key'],
    ['SCREENSHOT_PROVIDER', 'Screenshot service', { secret: false, help: 'screenshotone, browserless or screenshotlayer' }],
    ['SCREENSHOT_API_KEY', 'Screenshot service API key'],
    ['BROWSERLESS_ENDPOINT', 'Browserless address', { secret: false }],
    ['CONVERT_API_KEY', 'Convert.com API key'],
    ['CONVERT_API_SECRET', 'Convert.com API secret'],
  ]),
  ...G('Platform', [
    ['SHOPIFY_API_VERSION', 'Shopify API version', { secret: false }],
    ['FAILURE_ALERT_EMAILS', 'Who gets failure alerts', { secret: false, platformOnly: true, help: 'Comma-separated emails.' }],
    ['REPORT_EMAIL', 'Report email', { secret: false, platformOnly: true }],
  ]),
];
const BY_KEY = new Map(CATALOG.map(c => [c.key, c]));

const als = new AsyncLocalStorage();
const CACHE_MS = 60 * 1000;
const cache = new Map();          // 'platform' | 'w:<id>' | 'u:<id>' → { at, value }
const tokens = new Map();         // sha256(token) → { at, uid }

function enabled() { return process.env.APP_SETTINGS_DB === 'on' || (process.env.VERCEL === '1' && process.env.APP_SETTINGS_DB !== 'off'); }

/* ── process.env, resolved per request ── */
let installed = false;
function install() {
  if (installed) return;
  installed = true;
  const real = process.env;
  process.env = new Proxy(real, {
    get(t, k) {
      if (typeof k === 'string' && BY_KEY.has(k)) {
        const st = als.getStore();
        if (st && st.values && Object.prototype.hasOwnProperty.call(st.values, k)) return st.values[k];
      }
      return t[k];
    },
    has(t, k) {
      if (typeof k === 'string' && BY_KEY.has(k)) { const st = als.getStore(); if (st && st.values && Object.prototype.hasOwnProperty.call(st.values, k)) return true; }
      return k in t;
    },
    // process.env is a special object: writes and deletes must go straight to it.
    set(t, k, v) { t[k] = v; return true; },
    deleteProperty(t, k) { delete t[k]; return true; },
    defineProperty(t, k, d) { t[k] = d && 'value' in d ? d.value : undefined; return true; },
    ownKeys(t) { return Reflect.ownKeys(t); },
    getOwnPropertyDescriptor(t, k) { return Reflect.getOwnPropertyDescriptor(t, k); },
  });
}
install();

/* ── Reading settings ── */
function sb(method, path, body) {
  const { sbRest } = require('./supabase-rest.js');
  return sbRest(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, method, path, body);
}
async function cached(key, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
  return value;
}
function invalidate() { cache.clear(); }

async function readRows(filter, { workspace = false } = {}) {
  const box = require('./secret-box.js');
  if (!box.isConfigured()) return {};
  const r = await sb('GET', `/app_settings?${filter}&select=key,value_enc&limit=500`);
  if (!r.ok) return {};
  const out = {};
  for (const row of r.data || []) {
    const c = BY_KEY.get(row.key);
    if (!c || (workspace && c.platformOnly)) continue;
    try { const v = box.open(row.value_enc); if (typeof v === 'string' && v) out[row.key] = v; } catch { /* unreadable: fall back to the next source */ }
  }
  return out;
}
const platformValues = () => cached('platform', () => readRows('scope=eq.platform'));
async function workspaceOf(userId) {
  return cached(`u:${userId}`, async () => {
    const r = await sb('GET', `/profiles?id=eq.${userId}&select=workspace_id&limit=1`);
    return (r.ok && r.data && r.data[0] && r.data[0].workspace_id) || null;
  });
}
const workspaceValues = (wid) => cached(`w:${wid}`, () => readRows(`scope=eq.workspace&workspace_id=eq.${wid}`, { workspace: true }));

/** Merged values for an account (client's own over platform). */
async function valuesFor(userId) {
  if (!enabled()) return {};
  try {
    const platform = await platformValues();
    if (!userId || !/^[0-9a-f-]{36}$/i.test(String(userId))) return { ...platform };
    const wid = await workspaceOf(userId);
    return wid ? { ...platform, ...(await workspaceValues(wid)) } : { ...platform };
  } catch { return {}; }
}

/** The verified user behind a request's bearer token (cached briefly), or null. */
async function userFromRequest(req) {
  const h = req && req.headers && (req.headers.authorization || req.headers.Authorization);
  const token = typeof h === 'string' ? h.replace(/^Bearer\s+/i, '').trim() : '';
  if (!token || token.length < 20 || token === process.env.CRON_SECRET) return null;
  const k = crypto.createHash('sha256').update(token).digest('hex');
  const hit = tokens.get(k);
  if (hit && Date.now() - hit.at < 5 * 60 * 1000) return hit.uid;
  try {
    const res = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) });
    const uid = res.ok ? ((await res.json().catch(() => ({}))).id || null) : null;
    if (tokens.size > 1000) tokens.clear();
    tokens.set(k, { at: Date.now(), uid });
    return uid;
  } catch { return null; }
}

/* ── Running with the right settings ── */
async function runAs(userId, fn) {
  if (!enabled()) return fn();
  const values = await valuesFor(userId);
  return als.run({ userId: userId || null, values }, fn);
}
async function withRequest(req, fn) {
  if (!enabled()) return fn();
  const uid = await userFromRequest(req);
  return runAs(uid, fn);
}
/** Switch the current request/job over to an account's settings (e.g. a public page's owner). */
async function attachUser(userId) {
  const st = als.getStore();
  if (!st || !enabled()) return;
  st.values = await valuesFor(userId);
  st.userId = userId || null;
}
function current() { const st = als.getStore(); return st ? { userId: st.userId, keys: Object.keys(st.values || {}) } : null; }

module.exports = { CATALOG, BY_KEY, enabled, runAs, withRequest, attachUser, valuesFor, invalidate, current, userFromRequest, _als: als };
