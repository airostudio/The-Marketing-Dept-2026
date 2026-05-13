/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * CLAUDE API PROXY — Vercel Serverless Function
 * Securely proxies requests to Anthropic's Claude API using server-side API key.
 *
 * Hardening:
 *   - In-process IP rate limit (best-effort; per serverless instance)
 *   - Strict request validation (size, fields, message shape)
 *   - No leaking the resolved API key or its prefix in error responses
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS_CAP = 8192;
const MAX_MESSAGES = 100;
const MAX_BODY_BYTES = 256 * 1024; // 256 KB

// Best-effort in-memory rate limit. Resets when the serverless instance recycles.
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 20; // 20 req/min/IP per instance
const rateBuckets = new Map();

function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) return fwd.split(',')[0].trim();
  return req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
}

function checkRateLimit(ip) {
  const now = Date.now();
  const bucket = rateBuckets.get(ip);
  if (!bucket || now - bucket.start > RATE_LIMIT_WINDOW_MS) {
    rateBuckets.set(ip, { start: now, count: 1 });
    return { ok: true, remaining: RATE_LIMIT_MAX - 1 };
  }
  if (bucket.count >= RATE_LIMIT_MAX) {
    const retryAfter = Math.ceil((bucket.start + RATE_LIMIT_WINDOW_MS - now) / 1000);
    return { ok: false, retryAfter };
  }
  bucket.count += 1;
  return { ok: true, remaining: RATE_LIMIT_MAX - bucket.count };
}

function validateMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return 'messages must be a non-empty array';
  }
  if (messages.length > MAX_MESSAGES) {
    return `messages array exceeds limit of ${MAX_MESSAGES}`;
  }
  for (const m of messages) {
    if (!m || typeof m !== 'object') return 'each message must be an object';
    if (m.role !== 'user' && m.role !== 'assistant') {
      return 'message.role must be "user" or "assistant"';
    }
    if (typeof m.content !== 'string' && !Array.isArray(m.content)) {
      return 'message.content must be a string or array';
    }
  }
  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Rate limit
  const ip = getClientIp(req);
  const rl = checkRateLimit(ip);
  if (!rl.ok) {
    res.setHeader('Retry-After', String(rl.retryAfter));
    return res.status(429).json({ error: 'Too many requests', retryAfter: rl.retryAfter });
  }

  // Reject oversized payloads early
  const contentLength = parseInt(req.headers['content-length'] || '0', 10);
  if (contentLength > MAX_BODY_BYTES) {
    return res.status(413).json({ error: 'Request body too large' });
  }

  const apiKey =
    process.env.ANTHROPIC_API_KEY ||
    process.env.CLAUDE_API_KEY ||
    process.env.NEXT_PUBLIC_ANTHROPIC_API_KEY;

  if (!apiKey) {
    console.error('Claude proxy: ANTHROPIC_API_KEY not configured');
    return res.status(500).json({ error: 'API key not configured' });
  }

  if (!apiKey.startsWith('sk-ant-api')) {
    console.error('Claude proxy: API key has invalid format');
    return res.status(500).json({ error: 'API key not configured' });
  }

  try {
    const { model, max_tokens, messages, system, stream } = req.body || {};

    const msgError = validateMessages(messages);
    if (msgError) {
      return res.status(400).json({ error: msgError });
    }

    if (system !== undefined && typeof system !== 'string') {
      return res.status(400).json({ error: 'system must be a string' });
    }

    const requestBody = {
      model: typeof model === 'string' && model.length > 0 ? model : DEFAULT_MODEL,
      max_tokens: Math.min(Number.isInteger(max_tokens) && max_tokens > 0 ? max_tokens : 4096, MAX_TOKENS_CAP),
      messages,
      stream: Boolean(stream)
    };
    if (system) requestBody.system = system;

    const upstream = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION
      },
      body: JSON.stringify(requestBody)
    });

    if (requestBody.stream) {
      if (!upstream.ok) {
        const errorData = await upstream.json().catch(() => ({}));
        console.error('Claude proxy upstream error (stream):', upstream.status);
        return res.status(upstream.status).json({
          error: errorData.error || 'Upstream request failed'
        });
      }
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const reader = upstream.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(decoder.decode(value, { stream: true }));
      }
      return res.end();
    }

    if (!upstream.ok) {
      const errorData = await upstream.json().catch(() => ({}));
      console.error('Claude proxy upstream error:', upstream.status);
      return res.status(upstream.status).json({
        error: errorData.error || 'Upstream request failed'
      });
    }

    const data = await upstream.json();
    return res.status(200).json(data);
  } catch (error) {
    console.error('Claude proxy unexpected error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
