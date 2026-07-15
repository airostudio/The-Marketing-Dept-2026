/**
 * api/gemini.js
 * Vercel serverless function — proxies requests to Google Gemini API.
 * API key stored exclusively in GEMINI_API_KEY environment variable.
 *
 * Body: { messages, systemPrompt, model?, stream? }
 * Streaming: SSE chunks  → data: {"text":"..."}\n\n  …  data: [DONE]\n\n
 * Non-streaming: JSON    → { "text": "..." }
 */

/**
 * Gemini can return HTTP 200 with zero generated text — blocked by a safety
 * filter, blocked for recitation, or truncated at maxOutputTokens before any
 * visible text was produced. None of those are HTTP errors, so without this
 * check the proxy would silently forward an empty string and the caller has
 * no way to know why. Inspect promptFeedback/candidate finishReason to give
 * a real explanation instead of "the API returned an empty response."
 */
function describeEmptyGeminiResponse(data) {
  const blockReason = data?.promptFeedback?.blockReason;
  if (blockReason) return `Gemini blocked this request before generating a response (reason: ${blockReason}). Rephrase the prompt or reduce sensitive content.`;

  const candidate = data?.candidates?.[0];
  const finishReason = candidate?.finishReason;
  if (finishReason === 'SAFETY') return 'Gemini blocked its response for this request due to safety filters. Try rephrasing the prompt.';
  if (finishReason === 'RECITATION') return 'Gemini blocked its response because the output too closely matched existing copyrighted content. Try a more specific, original prompt.';
  if (finishReason === 'MAX_TOKENS') return 'Gemini hit the output token limit before producing any visible text (it may have spent the budget on internal reasoning). Try a shorter prompt or a more direct request.';
  if (finishReason && finishReason !== 'STOP') return `Gemini stopped generating without producing text (reason: ${finishReason}).`;
  if (!candidate) return 'Gemini returned no candidates for this request — the prompt may have been rejected before generation started.';
  return 'Gemini returned an empty response for this request with no explanation from the API. Try again, or simplify the prompt.';
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY is not configured in environment variables.' });
  }

  const {
    messages    = [],
    systemPrompt,
    model       = 'gemini-2.5-pro',
    stream      = true,
  } = req.body || {};

  if (!messages.length) {
    return res.status(400).json({ error: 'messages array is required' });
  }

  // Map OpenAI-style messages → Gemini format
  const contents = messages.map(m => ({
    role:  m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content || '' }],
  }));

  const geminiBody = {
    contents,
    generationConfig: {
      maxOutputTokens: 8192,
      temperature:     0.7,
    },
  };

  if (systemPrompt) {
    geminiBody.system_instruction = { parts: [{ text: systemPrompt }] };
  }

  /* ── Non-streaming ───────────────────────────────────────────────────────── */
  if (!stream) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    try {
      const r = await fetch(url, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(geminiBody),
      });
      if (!r.ok) {
        const errText = await r.text();
        return res.status(r.status).json({ error: errText });
      }
      const data = await r.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      if (!text) {
        return res.status(502).json({ error: describeEmptyGeminiResponse(data) });
      }
      return res.json({ text });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  /* ── Streaming (SSE) ─────────────────────────────────────────────────────── */
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?key=${apiKey}&alt=sse`;

  res.setHeader('Content-Type',     'text/event-stream');
  res.setHeader('Cache-Control',    'no-cache');
  res.setHeader('Connection',       'keep-alive');
  res.setHeader('X-Accel-Buffering','no');

  try {
    const r = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(geminiBody),
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
    let lastParsed = null; // last successfully-parsed chunk, for diagnosing an empty stream

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';           // keep incomplete last line

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const json = line.slice(6).trim();
        if (!json || json === '[DONE]') continue;
        try {
          const parsed = JSON.parse(json);
          lastParsed = parsed;
          const text  = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) { sawAnyText = true; res.write(`data: ${JSON.stringify({ text })}\n\n`); }
        } catch (_) {}
      }
    }

    // The stream completed with valid SSE framing but never produced a single
    // character of text — a safety block, recitation block, or MAX_TOKENS cut
    // off before any visible output. Without this, the client sees a clean
    // [DONE] and a permanently blank response with no idea why.
    if (!sawAnyText) {
      res.write(`data: ${JSON.stringify({ error: describeEmptyGeminiResponse(lastParsed || {}) })}\n\n`);
    }
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
  }

  res.write('data: [DONE]\n\n');
  res.end();
};
