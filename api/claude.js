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
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    console.error('ANTHROPIC_API_KEY not found in environment variables');
    return res.status(500).json({
      error: 'API key not configured. Please add ANTHROPIC_API_KEY to Vercel environment variables.'
    });
  }

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
    const response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify(requestBody),
    });

    // Handle streaming responses
    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        return res.status(response.status).json(errorData);
      }

      // Stream the response back to the client
      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        res.write(chunk);
      }

      res.end();
    } else {
      // Non-streaming response
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        return res.status(response.status).json(errorData);
      }

      const data = await response.json();
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
