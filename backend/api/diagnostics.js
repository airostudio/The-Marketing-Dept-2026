/**
 * Diagnostics API
 * Runs a structured health check across every subsystem the platform depends
 * on and returns a per-check status with a human-readable explanation when
 * something is wrong.
 *
 * GET  /api/diagnostics         – Run all system checks (DB, Claude proxy, env)
 * POST /api/diagnostics/project – Run checks for a specific project's integrations
 *
 * Response shape:
 *   {
 *     success: true,
 *     summary: { passed: 5, failed: 1, skipped: 2 },
 *     checks: [
 *       { id: 'db', name: 'PostgreSQL', status: 'ok', message: '...', latencyMs: 4 },
 *       { id: 'claude', name: 'Claude API', status: 'error', message: 'ANTHROPIC_API_KEY not set' },
 *       ...
 *     ]
 *   }
 */

const express = require('express');
const db = require('../config/database');

const router = express.Router();

const STATUS = Object.freeze({
  OK: 'ok',
  WARN: 'warn',
  ERROR: 'error',
  SKIPPED: 'skipped'
});

function withTiming(fn) {
  return async (...args) => {
    const start = Date.now();
    try {
      const result = await fn(...args);
      return { ...result, latencyMs: Date.now() - start };
    } catch (err) {
      return {
        status: STATUS.ERROR,
        message: err.message || 'Check threw an unexpected error',
        latencyMs: Date.now() - start
      };
    }
  };
}

// ─── Individual check functions ──────────────────────────────────────────────

const checkDatabase = withTiming(async () => {
  try {
    const result = await db.query('SELECT 1 AS ok');
    if (result.rows[0]?.ok !== 1) {
      return { status: STATUS.ERROR, message: 'Database responded but returned unexpected value' };
    }
    return { status: STATUS.OK, message: 'Connection healthy' };
  } catch (err) {
    return {
      status: STATUS.ERROR,
      message: explainPgError(err)
    };
  }
});

const checkProjectsTable = withTiming(async () => {
  try {
    const r = await db.query(
      `SELECT to_regclass('public.seo_projects') AS exists`
    );
    if (!r.rows[0].exists) {
      return {
        status: STATUS.ERROR,
        message: 'seo_projects table is missing. Run backend/database/migrations/001_seo_projects.sql against your database.'
      };
    }
    return { status: STATUS.OK, message: 'seo_projects table present' };
  } catch (err) {
    return { status: STATUS.ERROR, message: explainPgError(err) };
  }
});

const checkEnv = withTiming(async () => {
  const issues = [];
  if (!process.env.JWT_SECRET) issues.push('JWT_SECRET');
  if (!process.env.JWT_REFRESH_SECRET) issues.push('JWT_REFRESH_SECRET');
  if (!process.env.DB_PASSWORD) issues.push('DB_PASSWORD');
  if (process.env.NODE_ENV === 'production' && !process.env.CORS_ORIGIN) {
    issues.push('CORS_ORIGIN (required in production)');
  }
  if (issues.length === 0) {
    return { status: STATUS.OK, message: 'Required environment variables present' };
  }
  return {
    status: STATUS.ERROR,
    message: `Missing or invalid env vars: ${issues.join(', ')}`
  };
});

const checkClaudeKey = withTiming(async () => {
  const key =
    process.env.ANTHROPIC_API_KEY ||
    process.env.CLAUDE_API_KEY ||
    process.env.NEXT_PUBLIC_ANTHROPIC_API_KEY;
  if (!key) {
    return {
      status: STATUS.WARN,
      message: 'ANTHROPIC_API_KEY not configured. AI-powered features (insights, summaries, recommendations) will be unavailable until a key is added.'
    };
  }
  if (!key.startsWith('sk-ant-api')) {
    return {
      status: STATUS.ERROR,
      message: 'ANTHROPIC_API_KEY does not look right (expected prefix "sk-ant-api"). Verify the key at https://console.anthropic.com/.'
    };
  }
  // Do not call the real Anthropic API in a sync diagnostic — that costs money
  // and would block. Presence + format is the practical check.
  return { status: STATUS.OK, message: `Key configured (${key.length} chars)` };
});

const checkClaudeProxy = withTiming(async () => {
  // The Claude proxy is a Vercel serverless function, not part of this Express
  // process. We can only verify the source file exists and that the API key
  // it depends on is present (already covered above).
  const fs = require('fs');
  const path = require('path');
  const candidates = [
    path.resolve(__dirname, '../../api/claude.js'),
    path.resolve(process.cwd(), 'api/claude.js')
  ];
  const present = candidates.some((p) => {
    try { return fs.statSync(p).isFile(); } catch { return false; }
  });
  if (!present) {
    return {
      status: STATUS.WARN,
      message: 'Claude serverless handler (api/claude.js) not found. If you are running the Vercel deployment, this is required; if you are only running the Express backend, you can ignore this.'
    };
  }
  return { status: STATUS.OK, message: 'Claude proxy source present' };
});

// Pretty-print common pg error codes / messages.
function explainPgError(err) {
  if (err.code === 'ECONNREFUSED') {
    return `Cannot reach Postgres at ${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || 5432}. Is the database running and are DB_HOST/DB_PORT correct?`;
  }
  if (err.code === '28P01') {
    return 'Database authentication failed. Check DB_USER and DB_PASSWORD.';
  }
  if (err.code === '3D000') {
    return `Database "${process.env.DB_NAME || 'audema'}" does not exist. Create it (createdb) and run the schema.`;
  }
  if (err.code === '42P01') {
    return 'A required table is missing. Run backend/database/schema.sql (or the migrations) against your database.';
  }
  return err.message || 'Unknown database error';
}

// ─── System diagnostics ──────────────────────────────────────────────────────

router.get('/', async (req, res) => {
  const checks = [];

  const [env, db, proj, claudeKey, claudeProxy] = await Promise.all([
    checkEnv(),
    checkDatabase(),
    checkProjectsTable(),
    checkClaudeKey(),
    checkClaudeProxy()
  ]);

  checks.push({ id: 'env', name: 'Environment variables', ...env });
  checks.push({ id: 'db', name: 'PostgreSQL connection', ...db });
  checks.push({ id: 'seo_projects', name: 'seo_projects table', ...proj });
  checks.push({ id: 'claude_key', name: 'Anthropic API key', ...claudeKey });
  checks.push({ id: 'claude_proxy', name: 'Claude proxy handler', ...claudeProxy });

  const summary = checks.reduce(
    (acc, c) => {
      if (c.status === STATUS.OK) acc.passed += 1;
      else if (c.status === STATUS.SKIPPED) acc.skipped += 1;
      else if (c.status === STATUS.WARN) acc.warnings += 1;
      else acc.failed += 1;
      return acc;
    },
    { passed: 0, failed: 0, warnings: 0, skipped: 0 }
  );

  res.json({ success: true, summary, checks });
});

// ─── Per-project integration diagnostics ─────────────────────────────────────

/**
 * Check a single third-party integration. We only verify that the credential
 * is present and well-formed — we don't make real API calls (that would
 * burn quota and slow the page). Each provider gets a tailored explanation
 * so the user knows exactly what's missing.
 */
function checkIntegration(provider, creds) {
  if (!creds || typeof creds !== 'object') {
    return { status: STATUS.SKIPPED, message: 'Not enabled' };
  }
  switch (provider) {
    case 'google-analytics':
      if (!creds.propertyId) {
        return { status: STATUS.ERROR, message: 'Google Analytics property ID is missing. Add it in the wizard (e.g. G-XXXXXXXXXX or UA-XXXXX-X).' };
      }
      if (!/^(G-[A-Z0-9]{6,}|UA-\d+-\d+)$/i.test(creds.propertyId)) {
        return { status: STATUS.WARN, message: `Property ID "${creds.propertyId}" does not match the GA4 (G-) or UA- format.` };
      }
      return { status: STATUS.OK, message: 'Property ID configured' };

    case 'search-console':
      if (!creds.siteUrl) {
        return { status: STATUS.ERROR, message: 'Search Console site property URL is missing.' };
      }
      try {
        const u = new URL(creds.siteUrl);
        if (!['http:', 'https:', 'sc-domain:'].includes(u.protocol)) {
          return { status: STATUS.WARN, message: 'Site property URL should be a verified URL or sc-domain: identifier.' };
        }
      } catch {
        return { status: STATUS.ERROR, message: 'Site property URL is not a valid URL.' };
      }
      return { status: STATUS.OK, message: 'Site property configured' };

    case 'ahrefs':
    case 'semrush':
      if (!creds.apiKey) {
        return { status: STATUS.ERROR, message: `${provider} API key is missing. Add it in Settings → Integrations.` };
      }
      if (creds.apiKey.length < 16) {
        return { status: STATUS.WARN, message: `${provider} API key looks too short to be valid.` };
      }
      return { status: STATUS.OK, message: 'API key configured' };

    case 'moz':
      if (!creds.accessId || !creds.secretKey) {
        return { status: STATUS.ERROR, message: 'Moz requires both Access ID and Secret Key.' };
      }
      return { status: STATUS.OK, message: 'Credentials configured' };

    case 'slack':
      if (!creds.webhookUrl) {
        return { status: STATUS.ERROR, message: 'Slack webhook URL is missing.' };
      }
      if (!/^https:\/\/hooks\.slack\.com\//.test(creds.webhookUrl)) {
        return { status: STATUS.WARN, message: 'Webhook URL does not look like a Slack incoming-webhook URL.' };
      }
      return { status: STATUS.OK, message: 'Webhook configured' };

    case 'custom-api':
      if (!creds.endpoint) {
        return { status: STATUS.ERROR, message: 'Custom API endpoint URL is missing.' };
      }
      try { new URL(creds.endpoint); } catch {
        return { status: STATUS.ERROR, message: 'Custom API endpoint is not a valid URL.' };
      }
      return { status: STATUS.OK, message: 'Endpoint configured' };

    case 'google-business':
      // No credential fields exposed in the wizard for GBP.
      return { status: STATUS.WARN, message: 'Google Business Profile requires OAuth, which is not yet wired up.' };

    default:
      return { status: STATUS.SKIPPED, message: `Unknown integration "${provider}"` };
  }
}

router.post('/project', async (req, res) => {
  const { projectId } = req.body || {};
  if (!projectId) {
    return res.status(400).json({ success: false, error: 'projectId is required' });
  }

  try {
    const result = await db.query(
      `SELECT integrations FROM seo_projects WHERE id = $1 AND organization_id = $2`,
      [projectId, req.organizationId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Project not found' });
    }

    const integrations = result.rows[0].integrations || {};
    const checks = Object.entries(integrations).map(([provider, creds]) => ({
      id: provider,
      name: provider,
      ...checkIntegration(provider, creds)
    }));

    const summary = checks.reduce(
      (acc, c) => {
        if (c.status === STATUS.OK) acc.passed += 1;
        else if (c.status === STATUS.SKIPPED) acc.skipped += 1;
        else if (c.status === STATUS.WARN) acc.warnings += 1;
        else acc.failed += 1;
        return acc;
      },
      { passed: 0, failed: 0, warnings: 0, skipped: 0 }
    );

    res.json({ success: true, summary, checks });
  } catch (err) {
    if (err.code === '22P02') {
      return res.status(404).json({ success: false, error: 'Project not found' });
    }
    console.error('[diagnostics:project]', err.message);
    res.status(500).json({ success: false, error: 'Failed to run diagnostics' });
  }
});

module.exports = router;
