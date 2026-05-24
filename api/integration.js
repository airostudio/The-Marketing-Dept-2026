/**
 * Integration API proxy — Vercel serverless function.
 *
 * Routes authenticated requests to external marketing APIs.
 * All credentials are read from Vercel environment variables — never from the client.
 *
 * Supported services: ahrefs | semrush | dataforseo | mailchimp | sendgrid
 *
 * Request body: { service, endpoint, params, method, body }
 * Response:     upstream JSON (or error JSON)
 */

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 30;
const rateBuckets = new Map();

function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) return fwd.split(',')[0].trim();
  return req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
}

function checkRateLimit(ip) {
  const now = Date.now();
  let b = rateBuckets.get(ip);
  if (!b || now - b.windowStart > RATE_LIMIT_WINDOW_MS) {
    b = { windowStart: now, count: 0 };
    rateBuckets.set(ip, b);
  }
  b.count++;
  return b.count <= RATE_LIMIT_MAX;
}

// Build a query string from a plain object
function qs(params) {
  if (!params || typeof params !== 'object') return '';
  const pairs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  return pairs.length ? '?' + pairs.join('&') : '';
}

// ── Service routing ─────────────────────────────────────────────────────────

async function callAhrefs(endpoint, params, method, body) {
  const token = process.env.AHREFS_API_KEY;
  if (!token) throw Object.assign(new Error('AHREFS_API_KEY not configured'), { status: 503 });
  const url = `https://apiv2.ahrefs.com${endpoint || '/'}${qs({ ...params, token, output: 'json' })}`;
  return fetch(url, { method: method || 'GET', headers: { Accept: 'application/json' } });
}

async function callSemrush(endpoint, params, method, body) {
  const key = process.env.SEMRUSH_API_KEY;
  if (!key) throw Object.assign(new Error('SEMRUSH_API_KEY not configured'), { status: 503 });
  const url = `https://api.semrush.com/${endpoint || ''}${qs({ ...params, key })}`;
  return fetch(url, { method: method || 'GET', headers: { Accept: 'application/json' } });
}

async function callDataForSEO(endpoint, params, method, body) {
  const login    = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) throw Object.assign(new Error('DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD not configured'), { status: 503 });
  const auth = Buffer.from(`${login}:${password}`).toString('base64');
  const url  = `https://api.dataforseo.com/v3${endpoint}`;
  return fetch(url, {
    method: method || 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function callMailchimp(endpoint, params, method, body) {
  const key = process.env.MAILCHIMP_API_KEY;
  if (!key) throw Object.assign(new Error('MAILCHIMP_API_KEY not configured'), { status: 503 });
  const server = key.split('-').at(-1) || 'us1';
  const url    = `https://${server}.api.mailchimp.com/3.0${endpoint}${qs(params)}`;
  return fetch(url, {
    method: method || 'GET',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: body && method !== 'GET' ? JSON.stringify(body) : undefined,
  });
}

async function callSendGrid(endpoint, params, method, body) {
  const key = process.env.SENDGRID_API_KEY;
  if (!key) throw Object.assign(new Error('SENDGRID_API_KEY not configured'), { status: 503 });
  const url = `https://api.sendgrid.com/v3${endpoint}${qs(params)}`;
  return fetch(url, {
    method: method || 'GET',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: body && method !== 'GET' ? JSON.stringify(body) : undefined,
  });
}

const SERVICES = { ahrefs: callAhrefs, semrush: callSemrush, dataforseo: callDataForSEO, mailchimp: callMailchimp, sendgrid: callSendGrid };

// ── Handler ─────────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const ip = getClientIp(req);
  if (!checkRateLimit(ip)) {
    return res.status(429).json({ error: 'Rate limit exceeded' });
  }

  const { service, endpoint = '/', params, method = 'GET', body } = req.body || {};

  if (!service || !SERVICES[service]) {
    return res.status(400).json({ error: `Unknown service "${service}". Valid: ${Object.keys(SERVICES).join(', ')}` });
  }

  // Validate endpoint — must start with / and contain no double-dots
  if (typeof endpoint !== 'string' || !endpoint.startsWith('/') || endpoint.includes('..')) {
    return res.status(400).json({ error: 'Invalid endpoint' });
  }

  try {
    const upstream = await SERVICES[service](endpoint, params, method, body);
    const data = await upstream.json().catch(() => ({}));
    res.setHeader('Cache-Control', 'private, max-age=1800');
    return res.status(upstream.status).json(data);
  } catch (err) {
    const status = err.status || 502;
    return res.status(status).json({ error: err.message });
  }
}
