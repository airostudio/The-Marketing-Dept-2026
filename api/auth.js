/**
 * api/auth.js
 * Cross-device authentication for Aduma using Vercel KV + stateless JWTs.
 *
 * POST { action: 'register', email, password, firstname, lastname, org }
 * POST { action: 'login',    email, password }
 * GET  ?action=verify  — Authorization: Bearer <token>
 * POST { action: 'status' }  — returns { configured: true/false }
 *
 * Requires three Vercel environment variables:
 *   KV_REST_API_URL   — from Vercel Storage → KV (auto-added)
 *   KV_REST_API_TOKEN — from Vercel Storage → KV (auto-added)
 *   AUTH_JWT_SECRET   — any random 32+ char string  (e.g. openssl rand -hex 32)
 *
 * If any env var is missing the endpoint returns 503 so the client can
 * transparently fall back to localStorage-only mode.
 */

const crypto = require('crypto');

// ── Rate limiting ─────────────────────────────────────────────────────────────
const RATE_WINDOW = 60_000;
const RATE_MAX    = 20;
const rateBuckets = new Map();

function getIp(req) {
    const fwd = req.headers['x-forwarded-for'];
    if (typeof fwd === 'string') return fwd.split(',')[0].trim();
    return req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
}

function checkRate(ip) {
    const now = Date.now();
    let b = rateBuckets.get(ip);
    if (!b || now - b.t > RATE_WINDOW) { b = { t: now, n: 0 }; rateBuckets.set(ip, b); }
    return ++b.n <= RATE_MAX;
}

// ── JWT (HMAC-SHA256, stateless) ──────────────────────────────────────────────
function signJwt(payload, secret) {
    const h = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const p = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const s = crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url');
    return `${h}.${p}.${s}`;
}

function verifyJwt(token, secret) {
    const parts = (token || '').split('.');
    if (parts.length !== 3) return null;
    const [h, p, s] = parts;
    const expected = crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url');
    // Constant-time compare to prevent timing attacks
    try {
        if (!crypto.timingSafeEqual(Buffer.from(s, 'utf8'), Buffer.from(expected, 'utf8'))) return null;
    } catch { return null; }
    try {
        const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
        if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
        return payload;
    } catch { return null; }
}

// ── Password hashing (PBKDF2-SHA512) ─────────────────────────────────────────
function hashPwd(password, salt) {
    return crypto.pbkdf2Sync(password, salt, 100_000, 64, 'sha512').toString('hex');
}

// ── Vercel KV (Upstash Redis REST API) ───────────────────────────────────────
async function kvCmd(cmd, ...args) {
    const url   = process.env.KV_REST_API_URL;
    const token = process.env.KV_REST_API_TOKEN;
    if (!url || !token) return null;
    try {
        const r = await fetch(url, {
            method: 'POST',
            headers: {
                Authorization:  `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify([cmd, ...args]),
            signal: AbortSignal.timeout(5000),
        });
        if (!r.ok) return null;
        return (await r.json()).result ?? null;
    } catch { return null; }
}

async function kvGet(key) {
    const raw = await kvCmd('GET', key);
    if (raw == null) return null;
    try { return JSON.parse(raw); } catch { return raw; }
}

async function kvSet(key, value) {
    return kvCmd('SET', key, JSON.stringify(value));
}

// ── Main handler ──────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();

    const ip = getIp(req);
    if (!checkRate(ip)) return res.status(429).json({ error: 'Rate limit exceeded.' });

    const jwtSecret = process.env.AUTH_JWT_SECRET;
    const kvUrl     = process.env.KV_REST_API_URL;
    const kvToken   = process.env.KV_REST_API_TOKEN;
    const configured = !!(jwtSecret && kvUrl && kvToken);

    // Status check — used by client to decide whether to use API or localStorage
    const body   = req.body || {};
    const action = req.method === 'GET'
        ? (req.query?.action || new URL(req.url, 'http://x').searchParams.get('action'))
        : body.action;

    if (action === 'status') {
        return res.status(200).json({ configured });
    }

    if (!configured) {
        return res.status(503).json({
            error: 'Auth not configured',
            configured: false,
            message: [
                'To enable cross-device login, add these to your Vercel project:',
                '1. Enable Vercel KV Storage (Storage tab → Create Database → KV) — adds KV_REST_API_URL and KV_REST_API_TOKEN automatically.',
                '2. Add AUTH_JWT_SECRET = any random 32+ char string (run: openssl rand -hex 32).',
            ].join(' '),
        });
    }

    // ── GET: verify token ─────────────────────────────────────────────────────
    if (req.method === 'GET') {
        const authHeader = req.headers['authorization'] || '';
        const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
        const payload = verifyJwt(token, jwtSecret);
        if (!payload) return res.status(401).json({ error: 'Invalid or expired token.' });
        return res.status(200).json({ valid: true, user: payload.user });
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    // ── Register ──────────────────────────────────────────────────────────────
    if (action === 'register') {
        const { email, password, firstname, lastname, org } = body;
        if (!email || !password || !firstname || !lastname) {
            return res.status(400).json({ error: 'email, password, firstname, and lastname are required.' });
        }
        if (password.length < 8) {
            return res.status(400).json({ error: 'Password must be at least 8 characters.' });
        }

        const key      = `auth:u:${email.toLowerCase().trim()}`;
        const existing = await kvGet(key);
        if (existing) {
            return res.status(409).json({ error: 'An account with this email already exists.' });
        }

        const salt = crypto.randomBytes(32).toString('hex');
        const user = {
            id:        'u_' + Date.now(),
            email:     email.toLowerCase().trim(),
            firstname: firstname.trim(),
            lastname:  lastname.trim(),
            org:       (org || '').trim(),
            salt,
            pwhash:    hashPwd(password, salt),
            createdAt: new Date().toISOString(),
        };
        await kvSet(key, user);

        const pub   = { id: user.id, email: user.email, firstname: user.firstname, lastname: user.lastname, org: user.org };
        const token = signJwt({ user: pub, exp: Math.floor(Date.now() / 1000) + 30 * 86400 }, jwtSecret);
        res.setHeader('Cache-Control', 'no-store');
        return res.status(201).json({ token, user: pub });
    }

    // ── Login ─────────────────────────────────────────────────────────────────
    if (action === 'login') {
        const { email, password } = body;
        if (!email || !password) {
            return res.status(400).json({ error: 'email and password are required.' });
        }

        const key  = `auth:u:${email.toLowerCase().trim()}`;
        const user = await kvGet(key);
        if (!user) {
            return res.status(401).json({ error: 'No account found. Please create an account first.' });
        }

        const hash = hashPwd(password, user.salt);
        if (hash !== user.pwhash) {
            return res.status(401).json({ error: 'Incorrect password.' });
        }

        const pub   = { id: user.id, email: user.email, firstname: user.firstname, lastname: user.lastname, org: user.org };
        const token = signJwt({ user: pub, exp: Math.floor(Date.now() / 1000) + 30 * 86400 }, jwtSecret);
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({ token, user: pub });
    }

    return res.status(400).json({ error: `Unknown action: ${action || '(none)'}` });
};
