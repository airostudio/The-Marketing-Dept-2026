/**
 * api/openai.js
 * Vercel serverless function — proxies requests to OpenAI API.
 * API key stored exclusively in OPENAI_API_KEY environment variable.
 *
 * Body: { messages, systemPrompt, model?, stream? }
 * Streaming: SSE chunks  → data: {"text":"..."}\n\n  …  data: [DONE]\n\n
 * Non-streaming: JSON    → { "text": "..." }
 */

const { requireUser } = require('./_lib/require-user.js');
const { withFailureReporting } = require('./_lib/report-failure.js');

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

/**
 * OpenAI can return a 200 with zero visible content — most commonly
 * finish_reason "content_filter" (moderation blocked the output) or
 * "length" cutting off before any content token was emitted. Give a real
 * reason instead of silently forwarding an empty string.
 */
function describeEmptyOpenAIResponse(finishReason) {
  if (finishReason === 'content_filter') return 'OpenAI blocked this response due to content moderation. Try rephrasing the prompt.';
  if (finishReason === 'length') return 'OpenAI hit the output token limit before producing any visible text. Try a shorter prompt.';
  if (finishReason) return `OpenAI stopped generating without producing text (reason: ${finishReason}).`;
  return 'OpenAI returned an empty response for this request with no explanation from the API. Try again, or simplify the prompt.';
}

module.exports = withFailureReporting('api/openai', async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Free inference on the owner's OpenAI key for anyone with the URL, unless
  // we know who is asking.
  const auth = await requireUser(req, res);
  if (!auth) return;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'OPENAI_API_KEY is not configured in environment variables.' });
  }

  const {
    messages    = [],
    systemPrompt,
    model       = 'gpt-5.6-luna',
    stream      = true,
  } = req.body || {};

  if (!messages.length) {
    return res.status(400).json({ error: 'messages array is required' });
  }

  // Build OpenAI message array (system prompt as first message)
  const openaiMessages = [];
  if (systemPrompt) openaiMessages.push({ role: 'system', content: systemPrompt });
  openaiMessages.push(...messages);

  const body = {
    model,
    messages: openaiMessages,
    // OpenAI renamed this parameter for its current model line — sending
    // the old max_tokens key gets rejected outright with "Unsupported
    // parameter" rather than silently working, which is exactly what broke
    // every caller of this endpoint (default model gpt-5.6-luna requires
    // the new name; max_completion_tokens is what OpenAI's current chat
    // completions API expects across the board).
    max_completion_tokens: 4096,
    temperature: 0.7,
  };

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`,
  };

  /* ── Non-streaming ───────────────────────────────────────────────────────── */
  if (!stream) {
    try {
      const r = await fetch(OPENAI_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify({ ...body, stream: false }),
      });
      if (!r.ok) {
        const errText = await r.text();
        return res.status(r.status).json({ error: errText });
      }
      const data = await r.json();
      const text = data.choices?.[0]?.message?.content || '';
      if (!text) {
        return res.status(502).json({ error: describeEmptyOpenAIResponse(data.choices?.[0]?.finish_reason) });
      }
      return res.json({ text });
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
    const r = await fetch(OPENAI_URL, {
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
          const parsed = JSON.parse(json);
          const choice = parsed.choices?.[0];
          if (choice?.finish_reason) lastFinishReason = choice.finish_reason;
          const text = choice?.delta?.content;
          if (text) { sawAnyText = true; res.write(`data: ${JSON.stringify({ text })}\n\n`); }
        } catch (_) {}
      }
    }

    // Valid SSE stream, but never a single character of content — a content
    // filter block or a length cutoff before any token was emitted. Without
    // this the client sees a clean [DONE] and a permanently blank response.
    if (!sawAnyText) {
      res.write(`data: ${JSON.stringify({ error: describeEmptyOpenAIResponse(lastFinishReason) })}\n\n`);
    }
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
  }

  res.write('data: [DONE]\n\n');
  res.end();
});
