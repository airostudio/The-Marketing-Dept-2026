/**
 * api/_lib/google-sheets.js — a small Google Sheets / Drive client using a
 * service account, with no npm dependency: the service account's JSON key
 * signs a JWT (RS256, Node's crypto) that is exchanged for an access token.
 *
 * Env: GOOGLE_SERVICE_ACCOUNT_JSON — the key file's JSON, raw or base64. This
 * is the same service account the Webese Outreach platform uses
 * (WEBESE_GOOGLE_SERVICE_ACCOUNT_JSON there), so the state trackers it can
 * already see are shared with it. Optional: WEBESE_DRIVE_FOLDER_ID limits the
 * tracker search to one folder, as the Outreach platform does.
 */

'use strict';

const crypto = require('crypto');

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive.readonly'];
const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';
const DRIVE = 'https://www.googleapis.com/drive/v3/files';
const NOT_CONFIGURED = 'GOOGLE_SERVICE_ACCOUNT_JSON is not set. Copy the Webese service account JSON (the one the Outreach platform uses) into Vercel as GOOGLE_SERVICE_ACCOUNT_JSON.';

let cachedToken = null;   // { token, exp }

function credentials() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '';
  if (!raw.trim()) return null;
  try {
    const text = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
    const c = JSON.parse(text);
    return c.client_email && c.private_key ? c : null;
  } catch { return null; }
}

function serviceAccountEmail() { const c = credentials(); return c ? c.client_email : null; }

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

async function accessToken() {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.exp - 60 > now) return cachedToken.token;
  const c = credentials();
  if (!c) { const e = new Error(NOT_CONFIGURED); e.status = 503; throw e; }
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({ iss: c.client_email, scope: SCOPES.join(' '), aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(`${header}.${claim}`);
  const jwt = `${header}.${claim}.${b64url(signer.sign(c.private_key))}`;
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }).toString(),
    signal: AbortSignal.timeout(15000),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) { const e = new Error(`Google sign-in for the service account failed: ${d.error_description || d.error || r.status}`); e.status = 502; throw e; }
  cachedToken = { token: d.access_token, exp: now + (Number(d.expires_in) || 3600) };
  return cachedToken.token;
}

async function g(method, url, body) {
  const token = await accessToken();
  const r = await fetch(url, {
    method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = (d.error && d.error.message) || `HTTP ${r.status}`;
    const e = new Error(r.status === 403 || r.status === 404
      ? `Google Sheets refused access (${msg}). Share the sheet with ${serviceAccountEmail() || 'the service account'} as an Editor.`
      : `Google Sheets error: ${msg}`);
    e.status = r.status; throw e;
  }
  return d;
}

const q = (s) => encodeURIComponent(s);
const rangeOf = (tab, a1) => `'${String(tab).replace(/'/g, "''")}'${a1 ? '!' + a1 : ''}`;

/** Spreadsheets the service account can see whose name is exactly `name`. */
async function findSpreadsheetsByName(name) {
  const parts = ["mimeType='application/vnd.google-apps.spreadsheet'", 'trashed=false', `name='${String(name).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`];
  if (process.env.WEBESE_DRIVE_FOLDER_ID) parts.push(`'${process.env.WEBESE_DRIVE_FOLDER_ID}' in parents`);
  const d = await g('GET', `${DRIVE}?q=${q(parts.join(' and '))}&fields=${q('files(id,name,webViewLink)')}&pageSize=10&supportsAllDrives=true&includeItemsFromAllDrives=true`);
  return (d.files || []).map(f => ({ fileId: f.id, name: f.name, url: f.webViewLink }));
}

/** Several tabs at once → { tab: string[][] }. */
async function readTabs(fileId, tabs) {
  const d = await g('GET', `${SHEETS}/${fileId}/values:batchGet?${tabs.map(t => `ranges=${q(rangeOf(t))}`).join('&')}&valueRenderOption=FORMATTED_VALUE`);
  const out = {};
  tabs.forEach((t, i) => { out[t] = (d.valueRanges && d.valueRanges[i] && d.valueRanges[i].values) || []; });
  return out;
}

/** Append rows below the table in a tab. */
async function appendRows(fileId, tab, rows) {
  if (!rows.length) return { updatedRows: 0 };
  const d = await g('POST', `${SHEETS}/${fileId}/values/${q(rangeOf(tab, 'A1'))}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, { values: rows });
  return { updatedRows: (d.updates && d.updates.updatedRows) || 0, range: d.updates && d.updates.updatedRange };
}

/** Write single cells, then read them back; throws if any did not stick. */
async function writeCellsVerified(fileId, writes) {
  if (!writes.length) return;
  await g('POST', `${SHEETS}/${fileId}/values:batchUpdate`, { valueInputOption: 'RAW', data: writes.map(w => ({ range: rangeOf(w.tab, w.addr), values: [[w.value]] })) });
  const back = await g('GET', `${SHEETS}/${fileId}/values:batchGet?${writes.map(w => `ranges=${q(rangeOf(w.tab, w.addr))}`).join('&')}&valueRenderOption=FORMATTED_VALUE`);
  const bad = writes.filter((w, i) => String(((back.valueRanges[i] || {}).values || [[]])[0][0] ?? '') !== String(w.value));
  if (bad.length) { const e = new Error(`The sheet did not keep what was written to ${bad.map(w => rangeOf(w.tab, w.addr)).join(', ')}.`); e.status = 502; throw e; }
}

function colLetter(i0) {
  let n = i0 + 1, s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

function _resetForTests() { cachedToken = null; }

module.exports = { accessToken, findSpreadsheetsByName, readTabs, appendRows, writeCellsVerified, colLetter, serviceAccountEmail, credentials, NOT_CONFIGURED, _resetForTests };
