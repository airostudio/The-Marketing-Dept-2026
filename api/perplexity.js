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

/**
 * Perplexity can return a 200 with zero visible content (e.g. finish_reason
 * "content_filter" or "length" cutting off before any content token). Give
 * a real reason instead of silently forwarding an empty string.
 */
function describeEmptyPerplexityResponse(finishReason) {
  if (finishReason === 'content_filter') return 'Perplexity blocked this response due to content moderation. Try rephrasing the prompt.';
  if (finishReason === 'length') return 'Perplexity hit the output token limit before producing any visible text. Try a shorter prompt.';
  if (finishReason) return `Perplexity stopped generating without producing text (reason: ${finishReason}).`;
  return 'Perplexity returned an empty response for this request with no explanation from the API. Try again, or simplify the prompt.';
}

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
      if (!text) {
        return res.status(502).json({ error: describeEmptyPerplexityResponse(data.choices?.[0]?.finish_reason) });
      }
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
    let sawAnyText = false;
    let lastFinishReason = null;

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
          const choice    = parsed.choices?.[0];
          if (choice?.finish_reason) lastFinishReason = choice.finish_reason;
          const text      = choice?.delta?.content;
          const citations = parsed.citations;
          if (text)      { sawAnyText = true; res.write(`data: ${JSON.stringify({ text })}\n\n`); }
          if (citations) res.write(`data: ${JSON.stringify({ citations })}\n\n`);
        } catch (_) {}
      }
    }

    // Valid SSE stream, but never a single character of content — without
    // this the client sees a clean [DONE] and a permanently blank response.
    if (!sawAnyText) {
      res.write(`data: ${JSON.stringify({ error: describeEmptyPerplexityResponse(lastFinishReason) })}\n\n`);
    }
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
  }

  res.write('data: [DONE]\n\n');
  res.end();
};
