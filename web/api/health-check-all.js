/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * COMPREHENSIVE API HEALTH CHECK — Vercel Serverless Function
 * Tests all API integrations and returns detailed connection status
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

/**
 * Test Claude API connection
 */
async function testClaudeAPI(apiKey) {
  const result = {
    name: 'Claude AI (Anthropic)',
    key: 'ANTHROPIC_API_KEY',
    status: 'disconnected',
    reason: null,
    details: {},
    tested_at: new Date().toISOString()
  };

  try {
    // Check if key exists
    if (!apiKey) {
      result.reason = 'API key not found in environment variables';
      result.details.checked_vars = ['ANTHROPIC_API_KEY', 'CLAUDE_API_KEY', 'NEXT_PUBLIC_ANTHROPIC_API_KEY'];
      result.details.fix = 'Add ANTHROPIC_API_KEY to Vercel environment variables';
      return result;
    }

    // Check key format
    if (!apiKey.startsWith('sk-ant-api')) {
      result.reason = 'Invalid API key format';
      result.details.expected_format = 'sk-ant-api...';
      result.details.actual_format = `${apiKey.substring(0, 6)}...`;
      result.details.fix = 'Get a valid API key from https://console.anthropic.com/';
      return result;
    }

    result.details.key_preview = `${apiKey.substring(0, 11)}...${apiKey.substring(apiKey.length - 4)}`;
    result.details.key_length = apiKey.length;

    // Test actual API connection with minimal request
    const response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 10,
        messages: [{ role: 'user', content: 'Hi' }]
      }),
      signal: AbortSignal.timeout(10000) // 10 second timeout
    });

    if (response.ok) {
      result.status = 'connected';
      result.reason = 'API connection successful';
      result.details.response_status = response.status;
      result.details.model = 'claude-sonnet-4-6';
      result.details.endpoint = ANTHROPIC_API_URL;
    } else {
      const errorData = await response.json().catch(() => ({}));
      result.reason = `API error: ${errorData.error?.message || response.statusText}`;
      result.details.http_status = response.status;
      result.details.error_type = errorData.error?.type;

      // Provide specific fixes based on error type
      if (response.status === 401) {
        result.details.fix = 'API key is invalid or expired. Get a new key from https://console.anthropic.com/';
      } else if (response.status === 429) {
        result.details.fix = 'Rate limit exceeded. Wait a moment and try again, or upgrade your Anthropic plan.';
      } else if (response.status === 403) {
        result.details.fix = 'API key lacks necessary permissions. Check your Anthropic account settings.';
      } else {
        result.details.fix = 'Check Anthropic API status at https://status.anthropic.com/';
      }
    }

  } catch (error) {
    result.reason = `Connection error: ${error.message}`;
    result.details.error_type = error.name;

    if (error.name === 'AbortError') {
      result.details.fix = 'Request timed out. Check your network connection or Anthropic API status.';
    } else if (error.message.includes('fetch')) {
      result.details.fix = 'Network error. Check internet connection and firewall settings.';
    } else {
      result.details.fix = 'Unexpected error. Check Vercel function logs for details.';
    }
  }

  return result;
}

/**
 * Test other API integrations (placeholder for future integrations)
 */
async function testOtherAPIs() {
  const results = [];

  // Google Analytics (if configured)
  const gaProperty = process.env.GA_PROPERTY_ID;
  if (gaProperty) {
    results.push({
      name: 'Google Analytics',
      key: 'GA_PROPERTY_ID',
      status: 'configured',
      reason: 'Property ID found',
      details: { property_id: gaProperty },
      tested_at: new Date().toISOString()
    });
  }

  // SendGrid (if configured)
  const sendgridKey = process.env.SENDGRID_API_KEY;
  if (sendgridKey) {
    results.push({
      name: 'SendGrid Email',
      key: 'SENDGRID_API_KEY',
      status: 'configured',
      reason: 'API key found',
      details: { key_preview: `${sendgridKey.substring(0, 8)}...` },
      tested_at: new Date().toISOString()
    });
  }

  // Database connection
  const dbHost = process.env.DB_HOST;
  if (dbHost) {
    results.push({
      name: 'PostgreSQL Database',
      key: 'DB_HOST',
      status: 'configured',
      reason: 'Database host found',
      details: {
        host: dbHost,
        database: process.env.DB_NAME || 'not set'
      },
      tested_at: new Date().toISOString()
    });
  }

  return results;
}

/**
 * Main handler
 */
export default async function handler(req, res) {
  // Allow GET requests for easy browser testing
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed. Use GET.' });
  }

  const startTime = Date.now();

  console.log('🔍 Starting comprehensive API health check...');

  // Get Claude API key
  const claudeApiKey = process.env.ANTHROPIC_API_KEY ||
                       process.env.CLAUDE_API_KEY ||
                       process.env.NEXT_PUBLIC_ANTHROPIC_API_KEY;

  // Test all APIs
  const results = {
    timestamp: new Date().toISOString(),
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'unknown',
    region: process.env.VERCEL_REGION || 'unknown',
    test_duration_ms: 0,
    overall_status: 'healthy',
    apis: []
  };

  // Test Claude API (critical)
  console.log('🤖 Testing Claude API...');
  const claudeResult = await testClaudeAPI(claudeApiKey);
  results.apis.push(claudeResult);

  // Test other APIs
  console.log('🔌 Checking other API configurations...');
  const otherResults = await testOtherAPIs();
  results.apis.push(...otherResults);

  // Calculate overall status
  const criticalApis = results.apis.filter(api =>
    api.key === 'ANTHROPIC_API_KEY'
  );

  const hasCriticalFailure = criticalApis.some(api => api.status === 'disconnected');
  const hasAnyFailure = results.apis.some(api => api.status === 'disconnected');

  if (hasCriticalFailure) {
    results.overall_status = 'critical';
    results.overall_message = 'Critical API (Claude AI) is not connected';
  } else if (hasAnyFailure) {
    results.overall_status = 'degraded';
    results.overall_message = 'Some APIs are not connected';
  } else {
    results.overall_status = 'healthy';
    results.overall_message = 'All APIs are connected';
  }

  results.test_duration_ms = Date.now() - startTime;

  // Summary counts
  results.summary = {
    total: results.apis.length,
    connected: results.apis.filter(a => a.status === 'connected').length,
    configured: results.apis.filter(a => a.status === 'configured').length,
    disconnected: results.apis.filter(a => a.status === 'disconnected').length
  };

  console.log(`✅ Health check complete in ${results.test_duration_ms}ms`);
  console.log(`Status: ${results.overall_status} (${results.summary.connected} connected, ${results.summary.disconnected} disconnected)`);

  // Return appropriate status code
  const statusCode = results.overall_status === 'healthy' ? 200 :
                     results.overall_status === 'degraded' ? 207 : 503;

  return res.status(statusCode).json(results);
}
