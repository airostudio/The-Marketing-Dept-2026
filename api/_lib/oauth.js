/**
 * api/_lib/oauth.js — "Sign in with…" for the accounts a business lets
 * Audema act on: LinkedIn, Facebook Pages, X, and Google (Search Console).
 *
 * The flow (api/oauth.js):
 *   start     → a signed-in user asks to connect; we seal { who, which
 *               business, PKCE verifier, expiry } into the OAuth `state`
 *               (AES-GCM via secret-box, so it can't be read or forged) and
 *               send the browser to the network's consent screen.
 *   callback  → the network sends the browser back with a code; we open the
 *               state, swap the code for tokens, find out which account/page
 *               it is, and save it as a connection (tokens encrypted).
 *   fresh()   → before every use, a token about to expire is refreshed; a
 *               refusal becomes an 'auth' fault, so the autopilot asks the
 *               business to sign in again instead of guessing.
 *
 * Each network needs an app registered by Audema's owner (client id and
 * secret in env, and the redirect URI <APP_BASE_URL>/api/oauth registered
 * with the network). Until then that network says "not set up yet".
 */

'use strict';

const crypto = require('crypto');
const box = require('./secret-box.js');

const str = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
const STATE_TTL_MS = 15 * 60 * 1000;
const FB = () => `https://graph.facebook.com/${process.env.FACEBOOK_GRAPH_VERSION || 'v21.0'}`;

function fail(message, status, kind, extra = {}) { const e = new Error(message); e.status = status; e.kind = kind; Object.assign(e, extra); return e; }

async function http(url, init, who, deps = {}) {
  let res;
  try { res = await (deps.fetch || fetch)(url, { redirect: 'manual', signal: AbortSignal.timeout(20000), ...init }); }
  catch (e) { throw fail(`${who} could not be reached: ${e.message}`, 0, 'transient'); }
  const text = await res.text().catch(() => '');
  let body = null; try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text.slice(0, 300) }; }
  if (!res.ok) {
    const detail = str((body && (body.error_description || (body.error && (body.error.message || body.error)) || body.detail || body.message || body.title || body.raw)) || '', 300);
    const s = res.status;
    if (s === 401 || s === 403 || (s === 400 && /invalid_grant|expired|revoked|invalid_token/i.test(detail))) throw fail(`${who} refused the sign-in${detail ? `: ${detail}` : ''}`, s, 'auth');
    if (s === 429) { const ra = Number(res.headers && res.headers.get && res.headers.get('retry-after')); throw fail(`${who} is rate limiting${detail ? `: ${detail}` : ''}`, s, 'rate_limited', { retryAfterMs: ra > 0 ? ra * 1000 : null }); }
    if (s >= 500) throw fail(`${who} had a server error (${s})`, s, 'transient');
    throw fail(`${who} said no (${s})${detail ? `: ${detail}` : ''}`, s, 'permanent');
  }
  return body || {};
}
const form = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v != null)).toString();
const basic = (id, secret) => 'Basic ' + Buffer.from(`${encodeURIComponent(id)}:${encodeURIComponent(secret)}`).toString('base64');
const expiresAt = (sec, now) => (Number(sec) > 0 ? new Date(now + Number(sec) * 1000).toISOString() : null);

/* ── LinkedIn: post as the member (w_member_social) ─────────────────────── */
const linkedin = {
  label: 'LinkedIn', kind: 'social', platforms: ['LinkedIn'],
  env: ['LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET'],
  help: 'Sign in with the LinkedIn account the posts should come from. Audema can then publish the posts you approve to that profile.',
  authUrl({ state, redirectUri }) {
    return `https://www.linkedin.com/oauth/v2/authorization?${form({ response_type: 'code', client_id: process.env.LINKEDIN_CLIENT_ID, redirect_uri: redirectUri, state, scope: 'openid profile w_member_social' })}`;
  },
  async finish({ code, redirectUri, now }, deps) {
    const t = await http('https://www.linkedin.com/oauth/v2/accessToken', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: process.env.LINKEDIN_CLIENT_ID, client_secret: process.env.LINKEDIN_CLIENT_SECRET }) }, 'LinkedIn', deps);
    const me = await http('https://api.linkedin.com/v2/userinfo', { headers: { Authorization: `Bearer ${t.access_token}` } }, 'LinkedIn', deps);
    if (!me.sub) throw fail('LinkedIn did not say which account this is.', 502, 'permanent');
    return {
      label: `LinkedIn — ${str(me.name, 80) || 'your profile'}`, siteUrl: null,
      config: { authorUrn: `urn:li:person:${me.sub}`, name: str(me.name, 120) },
      secret: { accessToken: t.access_token, refreshToken: t.refresh_token || null, expiresAt: expiresAt(t.expires_in, now) },
    };
  },
  async ping(conn, secret, deps) { await http('https://api.linkedin.com/v2/userinfo', { headers: { Authorization: `Bearer ${secret.accessToken}` } }, 'LinkedIn', deps); },
  async refresh(secret, deps, now) {
    if (!secret.refreshToken) throw fail('The LinkedIn sign-in has expired (LinkedIn sign-ins last about two months).', 401, 'auth');
    const t = await http('https://www.linkedin.com/oauth/v2/accessToken', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form({ grant_type: 'refresh_token', refresh_token: secret.refreshToken, client_id: process.env.LINKEDIN_CLIENT_ID, client_secret: process.env.LINKEDIN_CLIENT_SECRET }) }, 'LinkedIn', deps);
    return { accessToken: t.access_token, refreshToken: t.refresh_token || secret.refreshToken, expiresAt: expiresAt(t.expires_in, now) };
  },
};

/* ── Facebook Pages ─────────────────────────────────────────────────────── */
const facebook = {
  label: 'Facebook Page', kind: 'social', platforms: ['Facebook'],
  env: ['FACEBOOK_APP_ID', 'FACEBOOK_APP_SECRET'],
  help: 'Sign in with Facebook and choose the Page to post to. Audema publishes the posts you approve to that Page (never to your personal profile).',
  authUrl({ state, redirectUri }) {
    return `https://www.facebook.com/${process.env.FACEBOOK_GRAPH_VERSION || 'v21.0'}/dialog/oauth?${form({ client_id: process.env.FACEBOOK_APP_ID, redirect_uri: redirectUri, state, response_type: 'code', scope: 'pages_show_list,pages_manage_posts,pages_read_engagement' })}`;
  },
  async finish({ code, redirectUri }, deps) {
    const short = await http(`${FB()}/oauth/access_token?${form({ client_id: process.env.FACEBOOK_APP_ID, client_secret: process.env.FACEBOOK_APP_SECRET, redirect_uri: redirectUri, code })}`, {}, 'Facebook', deps);
    // A long-lived user token gives Page tokens that don't expire.
    const long = await http(`${FB()}/oauth/access_token?${form({ grant_type: 'fb_exchange_token', client_id: process.env.FACEBOOK_APP_ID, client_secret: process.env.FACEBOOK_APP_SECRET, fb_exchange_token: short.access_token })}`, {}, 'Facebook', deps);
    const accounts = await http(`${FB()}/me/accounts?${form({ fields: 'id,name,access_token,tasks', limit: 50, access_token: long.access_token })}`, {}, 'Facebook', deps);
    const pages = (accounts.data || []).filter(p => p.access_token && (!Array.isArray(p.tasks) || p.tasks.includes('CREATE_CONTENT')));
    if (!pages.length) throw fail('That Facebook account can\'t post to any Page. Sign in with an account that manages the business\'s Page, and allow Audema to post to it.', 403, 'permanent');
    const first = pages[0];
    return {
      label: `Facebook — ${str(first.name, 80)}`, siteUrl: `https://www.facebook.com/${first.id}`,
      config: { pageId: first.id, pageName: str(first.name, 120), pages: pages.map(p => ({ id: p.id, name: str(p.name, 120) })) },
      secret: { pageTokens: Object.fromEntries(pages.map(p => [p.id, p.access_token])), expiresAt: null },
    };
  },
  async ping(conn, secret, deps) { await http(`${FB()}/${encodeURIComponent(conn.config.pageId)}?${form({ fields: 'id,name', access_token: (secret.pageTokens || {})[conn.config.pageId] || '' })}`, {}, 'Facebook', deps); },
  async refresh() { throw fail('The Facebook sign-in no longer works.', 401, 'auth'); },
};

/* ── X (OAuth 2.0 with PKCE) ───────────────────────────────────────────── */
const x = {
  label: 'X', kind: 'social', platforms: ['Twitter/X'], pkce: true,
  env: ['X_CLIENT_ID', 'X_CLIENT_SECRET'],
  help: 'Sign in with the X account the posts should come from. Audema publishes the posts you approve to it.',
  authUrl({ state, redirectUri, challenge }) {
    return `https://x.com/i/oauth2/authorize?${form({ response_type: 'code', client_id: process.env.X_CLIENT_ID, redirect_uri: redirectUri, scope: 'tweet.read tweet.write users.read offline.access', state, code_challenge: challenge, code_challenge_method: 'S256' })}`;
  },
  async finish({ code, redirectUri, verifier, now }, deps) {
    const t = await http('https://api.x.com/2/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: basic(process.env.X_CLIENT_ID, process.env.X_CLIENT_SECRET) }, body: form({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: verifier }) }, 'X', deps);
    const me = await http('https://api.x.com/2/users/me', { headers: { Authorization: `Bearer ${t.access_token}` } }, 'X', deps);
    const u = me.data || {};
    return {
      label: `X — @${str(u.username, 40) || 'account'}`, siteUrl: u.username ? `https://x.com/${u.username}` : null,
      config: { userId: u.id, username: str(u.username, 40) },
      secret: { accessToken: t.access_token, refreshToken: t.refresh_token || null, expiresAt: expiresAt(t.expires_in, now) },
    };
  },
  async ping(conn, secret, deps) { await http('https://api.x.com/2/users/me', { headers: { Authorization: `Bearer ${secret.accessToken}` } }, 'X', deps); },
  async refresh(secret, deps, now) {
    if (!secret.refreshToken) throw fail('The X sign-in has expired.', 401, 'auth');
    const t = await http('https://api.x.com/2/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: basic(process.env.X_CLIENT_ID, process.env.X_CLIENT_SECRET) }, body: form({ grant_type: 'refresh_token', refresh_token: secret.refreshToken }) }, 'X', deps);
    // X rotates refresh tokens: the old one stops working.
    return { accessToken: t.access_token, refreshToken: t.refresh_token || secret.refreshToken, expiresAt: expiresAt(t.expires_in, now) };
  },
};

/* ── Google Search Console (read-only) ─────────────────────────────────── */
const gsc = {
  label: 'Google Search Console', kind: 'data',
  env: ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET'],
  help: 'Sign in with the Google account that has your site in Search Console. Audema only reads your search data (read-only); it never changes anything in Google.',
  authUrl({ state, redirectUri }) {
    return `https://accounts.google.com/o/oauth2/v2/auth?${form({ client_id: process.env.GOOGLE_OAUTH_CLIENT_ID, redirect_uri: redirectUri, response_type: 'code', scope: 'https://www.googleapis.com/auth/webmasters.readonly', access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state })}`;
  },
  async finish({ code, redirectUri, now, hint }, deps) {
    const t = await http('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: process.env.GOOGLE_OAUTH_CLIENT_ID, client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET }) }, 'Google', deps);
    if (!t.refresh_token) throw fail('Google did not grant lasting access. Remove Audema under your Google account\'s third-party access, then connect again.', 400, 'permanent');
    const sites = await http('https://www.googleapis.com/webmasters/v3/sites', { headers: { Authorization: `Bearer ${t.access_token}` } }, 'Search Console', deps);
    const usable = (sites.siteEntry || []).filter(s => s.permissionLevel && s.permissionLevel !== 'siteUnverifiedUser').map(s => s.siteUrl);
    if (!usable.length) throw fail('That Google account has no verified sites in Search Console. Add and verify your site in Search Console first.', 403, 'permanent');
    const pick = pickProperty(usable, hint);
    return {
      label: `Search Console — ${pick.replace(/^sc-domain:/, '').replace(/^https?:\/\//, '').replace(/\/$/, '')}`, siteUrl: pick.startsWith('sc-domain:') ? `https://${pick.slice(10)}` : pick,
      config: { property: pick, properties: usable.slice(0, 50) },
      secret: { accessToken: t.access_token, refreshToken: t.refresh_token, expiresAt: expiresAt(t.expires_in, now) },
    };
  },
  async ping(conn, secret, deps) { await http('https://www.googleapis.com/webmasters/v3/sites', { headers: { Authorization: `Bearer ${secret.accessToken}` } }, 'Search Console', deps); },
  async refresh(secret, deps, now) {
    const t = await http('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form({ grant_type: 'refresh_token', refresh_token: secret.refreshToken, client_id: process.env.GOOGLE_OAUTH_CLIENT_ID, client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET }) }, 'Google', deps);
    return { accessToken: t.access_token, refreshToken: t.refresh_token || secret.refreshToken, expiresAt: expiresAt(t.expires_in, now) };
  },
};

/** The Search Console property that matches the business's site (domain property preferred). */
function pickProperty(list, siteUrl) {
  let host = ''; try { host = new URL(siteUrl).hostname.replace(/^www\./, ''); } catch { /* none */ }
  if (host) {
    const dom = list.find(p => p === `sc-domain:${host}`);
    if (dom) return dom;
    const pre = list.find(p => { try { return new URL(p).hostname.replace(/^www\./, '') === host; } catch { return false; } });
    if (pre) return pre;
  }
  return list[0];
}

const PROVIDERS = { linkedin, facebook, x, gsc };
const isConfigured = (id) => !!PROVIDERS[id] && PROVIDERS[id].env.every(k => process.env[k]);

/* ── State and PKCE ────────────────────────────────────────────────────── */
function pkcePair() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  return { verifier, challenge: crypto.createHash('sha256').update(verifier).digest('base64url') };
}
function sealState(o, now = Date.now()) { return box.seal({ ...o, exp: now + STATE_TTL_MS, n: crypto.randomBytes(6).toString('base64url') }); }
function openState(s, now = Date.now()) {
  let o; try { o = box.open(s); } catch { return null; }
  if (!o || typeof o !== 'object' || !(o.exp > now)) return null;
  return o;
}

/**
 * A connection's token, refreshed first if it is about to expire. Saves the
 * new token. Any refusal is an 'auth' fault with the connection attached.
 */
async function fresh(sb, conn, deps = {}) {
  const p = PROVIDERS[conn.provider];
  const now = (deps.now || Date.now)();
  const s = conn.secret || {};
  const exp = s.expiresAt ? Date.parse(s.expiresAt) : null;
  if (!exp || exp - now > 5 * 60 * 1000) return s;
  try {
    const next = await p.refresh(s, deps, now);
    await sb('PATCH', `/connections?id=eq.${conn.id}`, { secret_enc: box.seal({ ...s, ...next }), last_ok_at: new Date(now).toISOString() });
    conn.secret = { ...s, ...next };
    return conn.secret;
  } catch (e) {
    if (e.kind === 'auth' || e.kind === 'permanent') { e.kind = 'auth'; e.connectionId = conn.id; e.connectionLabel = conn.label; }
    throw e;
  }
}

module.exports = { PROVIDERS, isConfigured, pkcePair, sealState, openState, fresh, pickProperty, http, fail };
