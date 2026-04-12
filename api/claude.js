/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * CLAUDE API PROXY — Vercel Serverless Function
 * Securely proxies requests to Anthropic's Claude API using server-side API key
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

/**
 * Vercel Serverless Function
 * Environment Variables Required:
 *   - ANTHROPIC_API_KEY: Your Claude API key from Vercel environment variables
 */
export default async function handler(req, res) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Get API key from environment variables
  // Try multiple possible environment variable names
  const apiKey = process.env.ANTHROPIC_API_KEY ||
                 process.env.CLAUDE_API_KEY ||
                 process.env.NEXT_PUBLIC_ANTHROPIC_API_KEY;

  if (!apiKey) {
    console.error('❌ API key not found in environment variables');
    console.error('Checked variables: ANTHROPIC_API_KEY, CLAUDE_API_KEY, NEXT_PUBLIC_ANTHROPIC_API_KEY');
    console.error('Available env vars:', Object.keys(process.env).filter(k => k.includes('API') || k.includes('ANTHROPIC') || k.includes('CLAUDE')));

    return res.status(500).json({
      error: 'API key not configured',
      details: 'ANTHROPIC_API_KEY not found in environment variables',
      help: {
        message: 'Please add ANTHROPIC_API_KEY to Vercel environment variables',
        steps: [
          '1. Go to Vercel Dashboard → Your Project → Settings → Environment Variables',
          '2. Add variable: ANTHROPIC_API_KEY',
          '3. Set value to your Claude API key (starts with sk-ant-api)',
          '4. Select all environments (Production, Preview, Development)',
          '5. Redeploy your application'
        ],
        diagnosticUrl: '/api/health'
      }
    });
  }

  // Validate API key format
  if (!apiKey.startsWith('sk-ant-api')) {
    console.warn('⚠️ API key format looks incorrect. Should start with sk-ant-api');
    return res.status(500).json({
      error: 'Invalid API key format',
      details: 'API key should start with sk-ant-api',
      help: 'Please check your Claude API key at https://console.anthropic.com/'
    });
  }

  console.log(`✅ API key found (${apiKey.substring(0, 11)}...${apiKey.substring(apiKey.length - 4)})`);
  console.log(`📍 Environment: ${process.env.VERCEL_ENV || 'development'}`);

  try {
    const { model, max_tokens, messages, system, stream } = req.body;

    // Validate required fields
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Invalid request: messages array required' });
    }

    // Build request body
    const requestBody = {
      model: model || 'claude-sonnet-4-6',
      max_tokens: max_tokens || 4096,
      messages,
      stream: stream || false,
    };

    if (system) {
      requestBody.system = system;
    }

    // Call Anthropic API
    console.log('🚀 Calling Anthropic API...');
    console.log('Model:', requestBody.model);
    console.log('Stream:', requestBody.stream);

    const response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify(requestBody),
    });

    console.log('📡 Anthropic API response status:', response.status);

    // Handle streaming responses
    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      // Prevent nginx / Vercel edge from buffering SSE — bytes must flow immediately
      res.setHeader('X-Accel-Buffering', 'no');

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('❌ Anthropic API error (streaming):', response.status, errorData);
        return res.status(response.status).json({
          error: errorData.error || 'API request failed',
          status: response.status,
          details: errorData
        });
      }

      // Keep-alive: send an SSE comment every 15 s while Claude is "thinking".
      // SSE comments (lines starting with ':') are ignored by EventSource parsers
      // but prevent CDN/proxy idle-timeout from killing the connection before the
      // first real chunk arrives (Vercel edge default idle cutoff is ~30 s).
      const keepAliveInterval = setInterval(() => {
        try { res.write(': keep-alive\n\n'); } catch (_) { /* stream already closed */ }
      }, 15000);

      // Stream the response back to the client
      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          res.write(chunk);
        }
      } finally {
        clearInterval(keepAliveInterval);
        res.end();
      }
    } else {
      // Non-streaming response
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('❌ Anthropic API error (non-streaming):', response.status, errorData);
        return res.status(response.status).json({
          error: errorData.error || 'API request failed',
          status: response.status,
          details: errorData
        });
      }

      const data = await response.json();
      console.log('✅ Anthropic API success');
      return res.status(200).json(data);
    }
  } catch (error) {
    console.error('Claude API Error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
}
