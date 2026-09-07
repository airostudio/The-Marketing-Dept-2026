/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * HEALTH CHECK ENDPOINT — Vercel Serverless Function
 * Diagnostic endpoint to verify environment variables and API configuration
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const { requireAdmin } = require('./_lib/require-user.js');

module.exports = async function handler(req, res) {
  // Allow GET requests for easy browser testing
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed. Use GET.' });
  }

  // This endpoint served the deployment's configuration to anyone who asked:
  // which API keys exist, how long they are, and the names of every
  // Anthropic/Claude/API_KEY/Vercel environment variable. That is a map of the
  // system for someone deciding what to attack. It is an operator tool, so it
  // now answers operators only.
  const auth = await requireAdmin(req, res);
  if (!auth) return;

  const diagnostics = {
    timestamp: new Date().toISOString(),
    status: 'healthy',
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'unknown',
    region: process.env.VERCEL_REGION || 'unknown',
    checks: {
      apiKeyConfigured: false,
      apiKeyFormat: null,
      apiKeyLength: 0,
      environmentVariables: {}
    }
  };

  // Check if ANTHROPIC_API_KEY is configured
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (apiKey) {
    diagnostics.checks.apiKeyConfigured = true;
    diagnostics.checks.apiKeyLength = apiKey.length;

    // Validate API key format (should start with sk-ant-api)
    if (apiKey.startsWith('sk-ant-api')) {
      diagnostics.checks.apiKeyFormat = 'valid';
    } else {
      diagnostics.checks.apiKeyFormat = 'invalid - should start with sk-ant-api';
      diagnostics.status = 'degraded';
    }

    // No preview. "Only 15 of the characters" is still 15 characters of a
    // live secret in a log, a screenshot or a bug report, and it buys nothing
    // that `configured: true` plus the format check has not already told an
    // operator.
  } else {
    diagnostics.checks.apiKeyConfigured = false;
    diagnostics.checks.apiKeyFormat = 'missing';
    diagnostics.status = 'unhealthy';
    diagnostics.error = 'ANTHROPIC_API_KEY not found in environment variables';
  }

  // Check for common environment variable issues
  const envVars = process.env;
  const relevantEnvVars = Object.keys(envVars).filter(key =>
    key.includes('ANTHROPIC') ||
    key.includes('CLAUDE') ||
    key.includes('API_KEY') ||
    key.includes('VERCEL')
  );

  diagnostics.checks.environmentVariables = {
    total: Object.keys(envVars).length,
    relevant: relevantEnvVars,
    hasAnthropicApiKey: 'ANTHROPIC_API_KEY' in envVars,
    hasClaudeApiKey: 'CLAUDE_API_KEY' in envVars,
  };

  // Return appropriate status code
  const statusCode = diagnostics.status === 'healthy' ? 200 :
                     diagnostics.status === 'degraded' ? 207 : 500;

  return res.status(statusCode).json(diagnostics);
}
