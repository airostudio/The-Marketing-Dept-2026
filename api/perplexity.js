/**
 * api/perplexity.js
 * Vercel serverless function — proxies requests to Perplexity Sonar API.
 * API key stored exclusively in PERPLEXITY_API_KEY environment variable.
 *
 * Perplexity Sonar models have live web search built in — ideal for
 * competitive intelligence and real-time market data.
 *
 * Body: { messages, systemPrompt, model?, stream? }
 * Streaming: SSE chunks  → data: {"text":"..."}\n\n  …  data: [DONE]\n\n
 * Non-streaming: JSON    → { "text": "...", "citations": [...] }
 */

const PERPLEXITY_URL = 'https://api.perplexity.ai/chat/completions';

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'PERPLEXITY_API_KEY is not configured in environment variables.' });
  }

  const {
    messages    = [],
    systemPrompt,
    model       = 'sonar-pro',
    stream      = true,
  } = req.body || {};

  if (!messages.length) {
    return res.status(400).json({ error: 'messages array is required' });
  }

  // Build message array (system prompt as first message)
  const perplexityMessages = [];
  if (systemPrompt) perplexityMessages.push({ role: 'system', content: systemPrompt });
  perplexityMessages.push(...messages);

  const body = {
    model,
    messages: perplexityMessages,
    max_tokens: 4096,
    temperature: 0.2,   // lower temp for factual competitive intel
  };

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`,
  };

  /* ── Non-streaming ───────────────────────────────────────────────────────── */
  if (!stream) {
    try {
      const r = await fetch(PERPLEXITY_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify({ ...body, stream: false }),
      });
      if (!r.ok) {
        const errText = await r.text();
        return res.status(r.status).json({ error: errText });
      }
      const data     = await r.json();
      const text     = data.choices?.[0]?.message?.content || '';
      const citations = data.citations || [];
      return res.json({ text, citations });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  /* ── Streaming (SSE) ─────────────────────────────────────────────────────── */
  res.setHeader('Content-Type',      'text/event-stream');
  res.setHeader('Cache-Control',     'no-cache');
  res.setHeader('Connection',        'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  try {
    const r = await fetch(PERPLEXITY_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ...body, stream: true }),
    });

    if (!r.ok) {
      const errText = await r.text();
      res.write(`data: ${JSON.stringify({ error: errText })}\n\n`);
      res.end();
      return;
    }

    const reader  = r.body.getReader();
    const decoder = new TextDecoder();
    let buffer    = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const json = line.slice(6).trim();
        if (!json || json === '[DONE]') continue;
        try {
          const parsed    = JSON.parse(json);
          const text      = parsed.choices?.[0]?.delta?.content;
          const citations = parsed.citations;
          if (text)      res.write(`data: ${JSON.stringify({ text })}\n\n`);
          if (citations) res.write(`data: ${JSON.stringify({ citations })}\n\n`);
        } catch (_) {}
      }
    }
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
  }

  res.write('data: [DONE]\n\n');
  res.end();
};
