/**
 * Auth API — Vercel Serverless Catch-All
 * Handles: /api/auth/login, /api/auth/signup, /api/auth/logout,
 *          /api/auth/refresh, /api/auth/me,
 *          /api/auth/forgot-password, /api/auth/reset-password
 *
 * Required env vars (set in Vercel dashboard):
 *   DATABASE_URL  — Postgres connection string (preferred)
 *   OR: DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD
 *   JWT_SECRET, JWT_REFRESH_SECRET
 */

import pkg from 'pg';
import jwt from 'jsonwebtoken';
import bcryptjs from 'bcryptjs';
import crypto from 'node:crypto';

const { Pool } = pkg;
const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;

// ─── Database pool (reused across warm invocations) ───────────────────────────
let _pool;
function pool() {
  if (_pool) return _pool;
  const cfg = process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }
    : {
        host:     process.env.DB_HOST     || 'localhost',
        port:     parseInt(process.env.DB_PORT || '5432'),
        database: process.env.DB_NAME     || 'audema',
        user:     process.env.DB_USER     || 'postgres',
        password: process.env.DB_PASSWORD,
      };
  _pool = new Pool({ ...cfg, max: 3 });
  return _pool;
}
const db = {
  query:  (sql, p) => pool().query(sql, p),
  client: ()       => pool().connect(),
};

// ─── JWT helpers ─────────────────────────────────────────────────────────────
const mkAccessToken  = id => jwt.sign({ userId: id }, process.env.JWT_SECRET,         { expiresIn: '1h' });
const mkRefreshToken = id => jwt.sign({ userId: id }, process.env.JWT_REFRESH_SECRET, { expiresIn: '7d' });

// ─── Account lockout (best-effort — per-instance in serverless) ───────────────
const lockouts = new Map();
function checkLockout(email) {
  const d = lockouts.get(email.toLowerCase());
  if (!d?.lockedUntil || Date.now() >= d.lockedUntil) return null;
  const m = Math.ceil((d.lockedUntil - Date.now()) / 60000);
  return `Account locked. Try again in ${m} minute${m === 1 ? '' : 's'}.`;
}
function recordFail(email) {
  const k = email.toLowerCase();
  const d = lockouts.get(k) || { count: 0, lockedUntil: null };
  if (++d.count >= 5) d.lockedUntil = Date.now() + 15 * 60 * 1000;
  lockouts.set(k, d);
}
function clearFail(email) { lockouts.delete(email.toLowerCase()); }

// ─── Auth middleware ──────────────────────────────────────────────────────────
async function requireAuth(req) {
  const hdr = req.headers.authorization;
  if (!hdr?.startsWith('Bearer ')) throw Object.assign(new Error('Unauthorised'), { status: 401 });
  const { userId } = jwt.verify(hdr.slice(7), process.env.JWT_SECRET);
  const { rows } = await db.query(
    `SELECT id, organization_id, email, first_name, last_name, role
     FROM users WHERE id = $1 AND status = 'active'`,
    [userId]
  );
  if (!rows.length) throw Object.assign(new Error('User not found'), { status: 401 });
  return rows[0];
}

// ─── Route handlers ───────────────────────────────────────────────────────────

async function login(req, res) {
  const { email, password } = req.body || {};
  if (!email || !password)
    return res.status(400).json({ success: false, error: 'Email and password required.' });

  const lock = checkLockout(email);
  if (lock) return res.status(429).json({ success: false, error: lock });

  const { rows } = await db.query(
    `SELECT id, organization_id, email, password_hash, first_name, last_name, role, status
     FROM users WHERE email = $1`,
    [email]
  );
  if (!rows.length) {
    recordFail(email);
    return res.status(401).json({ success: false, error: 'Invalid email or password.' });
  }

  const user = rows[0];
  if (user.status !== 'active')
    return res.status(403).json({ success: false, error: 'Account suspended. Contact support.' });

  const ok = await bcryptjs.compare(password, user.password_hash);
  if (!ok) {
    recordFail(email);
    return res.status(401).json({ success: false, error: 'Invalid email or password.' });
  }
  clearFail(email);

  const at = mkAccessToken(user.id), rt = mkRefreshToken(user.id);
  const exp = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await db.query('INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1,$2,$3)', [user.id, rt, exp]);
  await db.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);

  return res.json({
    success: true,
    data: {
      user: { id: user.id, email: user.email, firstName: user.first_name, lastName: user.last_name, role: user.role, organizationId: user.organization_id },
      accessToken: at, refreshToken: rt,
    },
  });
}

async function signup(req, res) {
  const { email, password, firstName, lastName, organizationName = 'My Organisation' } = req.body || {};
  if (!email || !password || !firstName || !lastName)
    return res.status(400).json({ success: false, error: 'All fields required.' });
  if (!PASSWORD_REGEX.test(password))
    return res.status(400).json({ success: false, error: 'Password must contain uppercase, lowercase, and a number (min 8 chars).' });

  const { rows: existing } = await db.query('SELECT id FROM users WHERE email = $1', [email]);
  if (existing.length)
    return res.status(409).json({ success: false, error: 'An account with this email already exists.' });

  const hash   = await bcryptjs.hash(password, 12);
  const client = await db.client();
  try {
    await client.query('BEGIN');
    const slug = organizationName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const { rows: [org] }  = await client.query(
      `INSERT INTO organizations (name, slug, plan_type, status) VALUES ($1,$2,'basic','active') RETURNING id`,
      [organizationName, slug]
    );
    const { rows: [user] } = await client.query(
      `INSERT INTO users (organization_id, email, password_hash, first_name, last_name, role, status)
       VALUES ($1,$2,$3,$4,$5,'owner','active')
       RETURNING id, email, first_name, last_name, role`,
      [org.id, email, hash, firstName, lastName]
    );
    const at = mkAccessToken(user.id), rt = mkRefreshToken(user.id);
    const exp = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await client.query('INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1,$2,$3)', [user.id, rt, exp]);
    await client.query('COMMIT');

    return res.status(201).json({
      success: true,
      data: {
        user: { id: user.id, email: user.email, firstName: user.first_name, lastName: user.last_name, role: user.role, organizationId: org.id },
        accessToken: at, refreshToken: rt,
      },
    });
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function logout(req, res) {
  const { refreshToken: rt } = req.body || {};
  if (rt) await db.query('DELETE FROM refresh_tokens WHERE token = $1', [rt]).catch(() => {});
  return res.json({ success: true, message: 'Logged out.' });
}

async function refresh(req, res) {
  const { refreshToken: rt } = req.body || {};
  if (!rt) return res.status(400).json({ success: false, error: 'Refresh token required.' });

  const { userId } = jwt.verify(rt, process.env.JWT_REFRESH_SECRET);
  const { rows }   = await db.query(
    'SELECT user_id FROM refresh_tokens WHERE token = $1 AND expires_at > NOW()',
    [rt]
  );
  if (!rows.length) return res.status(401).json({ success: false, error: 'Invalid or expired refresh token.' });

  return res.json({ success: true, data: { accessToken: mkAccessToken(userId) } });
}

async function me(req, res) {
  const user = await requireAuth(req);
  return res.json({
    success: true,
    data: { user: { id: user.id, email: user.email, firstName: user.first_name, lastName: user.last_name, role: user.role, organizationId: user.organization_id } },
  });
}

async function forgotPassword(req, res) {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ success: false, error: 'Email required.' });

  const { rows } = await db.query(
    `SELECT id FROM users WHERE email = $1 AND status = 'active'`, [email]
  );
  const ok = { success: true, message: 'If that email is registered, a reset link has been sent.' };
  if (!rows.length) return res.json(ok);

  const userId = rows[0].id;
  const token  = crypto.randomBytes(32).toString('hex');
  const tHash  = crypto.createHash('sha256').update(token).digest('hex');
  const exp    = new Date(Date.now() + 60 * 60 * 1000);

  await db.query('DELETE FROM password_reset_tokens WHERE user_id = $1', [userId]);
  await db.query(
    'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1,$2,$3)',
    [userId, tHash, exp]
  );

  if (process.env.NODE_ENV !== 'production') {
    console.log(`[DEV] Reset token for ${email}: ${token}`);
    return res.json({ ...ok, _devToken: token });
  }
  return res.json(ok);
}

async function resetPassword(req, res) {
  const { token, password } = req.body || {};
  if (!token || !password) return res.status(400).json({ success: false, error: 'Token and password required.' });
  if (!PASSWORD_REGEX.test(password))
    return res.status(400).json({ success: false, error: 'Password must contain uppercase, lowercase, and a number (min 8 chars).' });

  const tHash = crypto.createHash('sha256').update(token).digest('hex');
  const { rows } = await db.query(
    'SELECT user_id FROM password_reset_tokens WHERE token_hash = $1 AND expires_at > NOW()',
    [tHash]
  );
  if (!rows.length) return res.status(400).json({ success: false, error: 'Reset link is invalid or has expired.' });

  const userId = rows[0].user_id;
  const pwHash = await bcryptjs.hash(password, 12);
  const client = await db.client();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE users SET password_hash = $1 WHERE id = $2', [pwHash, userId]);
    await client.query('DELETE FROM password_reset_tokens WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM refresh_tokens WHERE user_id = $1', [userId]);
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }

  const { rows: emailRows } = await db.query('SELECT email FROM users WHERE id = $1', [userId]);
  if (emailRows.length) clearFail(emailRows[0].email);

  return res.json({ success: true, message: 'Password reset successfully. You can now log in.' });
}

// ─── Main entry point ─────────────────────────────────────────────────────────
export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const segs  = req.query.path;
  const route = Array.isArray(segs) ? segs[0] : (segs || '');

  try {
    switch (route) {
      case 'login':            return await login(req, res);
      case 'signup':           return await signup(req, res);
      case 'logout':           return await logout(req, res);
      case 'refresh':          return await refresh(req, res);
      case 'me':               return await me(req, res);
      case 'forgot-password':  return await forgotPassword(req, res);
      case 'reset-password':   return await resetPassword(req, res);
      default: return res.status(404).json({ success: false, error: 'Auth route not found.' });
    }
  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, error: 'Invalid or expired token.' });
    }
    console.error('[Auth]', route, err.message);
    return res.status(err.status || 500).json({ success: false, error: err.message || 'Internal server error.' });
  }
}
