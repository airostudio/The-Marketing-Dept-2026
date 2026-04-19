/**
 * Authentication API Routes
 * Handles user signup, login, token refresh, logout, forgot/reset password
 */

const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const Joi = require('joi');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const db = require('../config/database');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// ═══════════════════════════════════════════════════════════════════════════════
// AUTH-SPECIFIC RATE LIMITERS
// Much stricter than the global API limiter — prevents brute-force attacks.
// ═══════════════════════════════════════════════════════════════════════════════

const loginLimiter = rateLimit({
  windowMs:  15 * 60 * 1000, // 15 minutes
  max:       10,              // 10 attempts per IP per window
  message:   { success: false, error: 'Too many login attempts. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders:   false,
});

const signupLimiter = rateLimit({
  windowMs:  60 * 60 * 1000, // 1 hour
  max:       5,               // 5 signups per IP per hour
  message:   { success: false, error: 'Too many signup attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders:   false,
});

const forgotPasswordLimiter = rateLimit({
  windowMs:  60 * 60 * 1000, // 1 hour
  max:       3,               // 3 attempts per IP per hour
  message:   { success: false, error: 'Too many reset requests. Please try again in an hour.' },
  standardHeaders: true,
  legacyHeaders:   false,
});

// ═══════════════════════════════════════════════════════════════════════════════
// IN-MEMORY ACCOUNT LOCKOUT
// After MAX_ATTEMPTS failed logins for an email, lock for LOCKOUT_MS.
// Uses an in-memory Map — survives restarts only within the same process.
// For multi-instance deployments, move this to Redis.
// ═══════════════════════════════════════════════════════════════════════════════

const MAX_ATTEMPTS  = 5;
const LOCKOUT_MS    = 15 * 60 * 1000; // 15 minutes
const loginAttempts = new Map(); // email → { count, lockedUntil }

function checkLockout(email) {
  const key  = email.toLowerCase();
  const data = loginAttempts.get(key);
  if (!data) return null; // not locked
  if (data.lockedUntil && Date.now() < data.lockedUntil) {
    const remaining = Math.ceil((data.lockedUntil - Date.now()) / 60000);
    return `Account temporarily locked due to too many failed attempts. Try again in ${remaining} minute${remaining === 1 ? '' : 's'}.`;
  }
  return null;
}

function recordFailedAttempt(email) {
  const key  = email.toLowerCase();
  const data = loginAttempts.get(key) || { count: 0, lockedUntil: null };
  data.count++;
  if (data.count >= MAX_ATTEMPTS) {
    data.lockedUntil = Date.now() + LOCKOUT_MS;
  }
  loginAttempts.set(key, data);
}

function clearFailedAttempts(email) {
  loginAttempts.delete(email.toLowerCase());
}

// Clean up expired lockouts every 30 minutes to prevent memory leaks
setInterval(() => {
  const now = Date.now();
  for (const [key, data] of loginAttempts.entries()) {
    if (!data.lockedUntil || now > data.lockedUntil) {
      loginAttempts.delete(key);
    }
  }
}, 30 * 60 * 1000);

// ═══════════════════════════════════════════════════════════════════════════════
// VALIDATION SCHEMAS
// ═══════════════════════════════════════════════════════════════════════════════

const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;

const signupSchema = Joi.object({
  email:            Joi.string().email().max(255).required(),
  password:         Joi.string().min(8).max(128).pattern(PASSWORD_REGEX).required()
    .messages({ 'string.pattern.base': 'Password must contain at least one uppercase letter, one lowercase letter, and one number.' }),
  firstName:        Joi.string().min(1).max(100).required(),
  lastName:         Joi.string().min(1).max(100).required(),
  organizationName: Joi.string().min(1).max(200).required(),
});

const loginSchema = Joi.object({
  email:    Joi.string().email().max(255).required(),
  password: Joi.string().max(128).required(),
});

const forgotPasswordSchema = Joi.object({
  email: Joi.string().email().max(255).required(),
});

const resetPasswordSchema = Joi.object({
  token:    Joi.string().required(),
  password: Joi.string().min(8).max(128).pattern(PASSWORD_REGEX).required()
    .messages({ 'string.pattern.base': 'Password must contain at least one uppercase letter, one lowercase letter, and one number.' }),
});

// ═══════════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

function generateAccessToken(userId) {
  return jwt.sign(
    { userId },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '1h' }
  );
}

function generateRefreshToken(userId) {
  return jwt.sign(
    { userId },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d' }
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/auth/signup
// ═══════════════════════════════════════════════════════════════════════════════

router.post('/signup', signupLimiter, async (req, res) => {
  try {
    const { error, value } = signupSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ success: false, error: error.details[0].message });
    }

    const { email, password, firstName, lastName, organizationName } = value;

    const existingUser = await db.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existingUser.rows.length > 0) {
      return res.status(409).json({ success: false, error: 'An account with this email already exists.' });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      const orgSlug = organizationName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');

      const orgResult = await client.query(
        `INSERT INTO organizations (name, slug, plan_type, status) VALUES ($1, $2, $3, $4) RETURNING id`,
        [organizationName, orgSlug, 'basic', 'active']
      );
      const organizationId = orgResult.rows[0].id;

      const userResult = await client.query(
        `INSERT INTO users (organization_id, email, password_hash, first_name, last_name, role, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, email, first_name, last_name, role`,
        [organizationId, email, passwordHash, firstName, lastName, 'owner', 'active']
      );
      const user = userResult.rows[0];

      const accessToken  = generateAccessToken(user.id);
      const refreshToken = generateRefreshToken(user.id);
      const expiresAt    = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      await client.query(
        'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
        [user.id, refreshToken, expiresAt]
      );

      await client.query('COMMIT');

      return res.status(201).json({
        success: true,
        data: {
          user: { id: user.id, email: user.email, firstName: user.first_name, lastName: user.last_name, role: user.role, organizationId },
          accessToken,
          refreshToken,
        },
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ success: false, error: 'Failed to create account.' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/auth/login
// ═══════════════════════════════════════════════════════════════════════════════

router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { error, value } = loginSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ success: false, error: error.details[0].message });
    }

    const { email, password } = value;

    const lockoutMsg = checkLockout(email);
    if (lockoutMsg) {
      return res.status(429).json({ success: false, error: lockoutMsg });
    }

    const result = await db.query(
      `SELECT id, organization_id, email, password_hash, first_name, last_name, role, status
       FROM users WHERE email = $1`,
      [email]
    );

    // Same message for "not found" and "wrong password" — prevents user enumeration
    if (result.rows.length === 0) {
      recordFailedAttempt(email);
      return res.status(401).json({ success: false, error: 'Invalid email or password.' });
    }

    const user = result.rows[0];

    if (user.status !== 'active') {
      return res.status(403).json({ success: false, error: 'Account is suspended. Please contact support.' });
    }

    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    if (!isValidPassword) {
      recordFailedAttempt(email);
      return res.status(401).json({ success: false, error: 'Invalid email or password.' });
    }

    clearFailedAttempts(email);

    const accessToken  = generateAccessToken(user.id);
    const refreshToken = generateRefreshToken(user.id);
    const expiresAt    = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await db.query(
      'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
      [user.id, refreshToken, expiresAt]
    );

    await db.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);

    return res.json({
      success: true,
      data: {
        user: { id: user.id, email: user.email, firstName: user.first_name, lastName: user.last_name, role: user.role, organizationId: user.organization_id },
        accessToken,
        refreshToken,
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ success: false, error: 'Failed to login.' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/auth/refresh
// ═══════════════════════════════════════════════════════════════════════════════

router.post('/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(400).json({ success: false, error: 'Refresh token required.' });
    }

    jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);

    const result = await db.query(
      'SELECT user_id FROM refresh_tokens WHERE token = $1 AND expires_at > NOW()',
      [refreshToken]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ success: false, error: 'Invalid or expired refresh token.' });
    }

    const accessToken = generateAccessToken(result.rows[0].user_id);
    return res.json({ success: true, data: { accessToken } });
  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, error: 'Invalid or expired refresh token.' });
    }
    console.error('Token refresh error:', err);
    res.status(500).json({ success: false, error: 'Failed to refresh token.' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/auth/logout
// ═══════════════════════════════════════════════════════════════════════════════

router.post('/logout', authenticate, async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (refreshToken) {
      await db.query('DELETE FROM refresh_tokens WHERE token = $1', [refreshToken]);
    }
    return res.json({ success: true, message: 'Logged out successfully.' });
  } catch (err) {
    console.error('Logout error:', err);
    res.status(500).json({ success: false, error: 'Failed to logout.' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/auth/me
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/me', authenticate, async (req, res) => {
  try {
    return res.json({
      success: true,
      data: {
        user: {
          id:             req.user.id,
          email:          req.user.email,
          firstName:      req.user.first_name,
          lastName:       req.user.last_name,
          role:           req.user.role,
          organizationId: req.user.organization_id,
        },
      },
    });
  } catch (err) {
    console.error('Get user error:', err);
    res.status(500).json({ success: false, error: 'Failed to get user.' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/auth/forgot-password
// Generates a secure reset token and (in production) would email it.
// In development the token is returned in the response body for testing.
// ═══════════════════════════════════════════════════════════════════════════════

router.post('/forgot-password', forgotPasswordLimiter, async (req, res) => {
  try {
    const { error, value } = forgotPasswordSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ success: false, error: error.details[0].message });
    }

    const { email } = value;

    const result = await db.query('SELECT id FROM users WHERE email = $1 AND status = $2', [email, 'active']);

    // Always return 200 — never reveal whether the email exists (prevents enumeration)
    if (result.rows.length === 0) {
      return res.json({ success: true, message: 'If that email is registered, a reset link has been sent.' });
    }

    const userId    = result.rows[0].id;
    const token     = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await db.query('DELETE FROM password_reset_tokens WHERE user_id = $1', [userId]);

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    await db.query(
      'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
      [userId, tokenHash, expiresAt]
    );

    // In production: send email via SendGrid/Postmark with the reset link
    // Reset link format: https://your-domain.com/auth.html?reset=<token>
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[DEV] Password reset token for ${email}: ${token}`);
      return res.json({
        success: true,
        message: 'If that email is registered, a reset link has been sent.',
        _devToken: token,
      });
    }

    return res.json({ success: true, message: 'If that email is registered, a reset link has been sent.' });
  } catch (err) {
    console.error('Forgot password error:', err);
    res.status(500).json({ success: false, error: 'Failed to process request.' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/auth/reset-password
// ═══════════════════════════════════════════════════════════════════════════════

router.post('/reset-password', async (req, res) => {
  try {
    const { error, value } = resetPasswordSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ success: false, error: error.details[0].message });
    }

    const { token, password } = value;

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const result = await db.query(
      `SELECT user_id FROM password_reset_tokens
       WHERE token_hash = $1 AND expires_at > NOW()`,
      [tokenHash]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ success: false, error: 'Reset link is invalid or has expired.' });
    }

    const userId      = result.rows[0].user_id;
    const passwordHash = await bcrypt.hash(password, 12);

    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      await client.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, userId]);
      await client.query('DELETE FROM password_reset_tokens WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM refresh_tokens WHERE user_id = $1', [userId]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    const userRow = await db.query('SELECT email FROM users WHERE id = $1', [userId]);
    if (userRow.rows.length > 0) clearFailedAttempts(userRow.rows[0].email);

    return res.json({ success: true, message: 'Password reset successfully. You can now log in.' });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ success: false, error: 'Failed to reset password.' });
  }
});

module.exports = router;
