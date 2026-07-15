/**
 * GeminiService — frontend client for /api/gemini
 * Mirrors the ClaudeService interface: streamResponse() and callAgent()
 */
window.GeminiService = (function () {
  'use strict';

  async function streamResponse({ systemPrompt, messages, model, onChunk, onDone, onError }) {
    try {
      const res = await fetch('/api/gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages,
          systemPrompt,
          model: model || 'gemini-2.5-pro',
          stream: true,
        }),
      });

      if (!res.ok) {
        let errMsg = res.statusText;
        try { const j = await res.json(); errMsg = j.error || errMsg; } catch (_) {}
        throw new Error(errMsg);
      }

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer      = '';
      let accumulated = '';
      let hadError    = false;

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
            if (parsed.error) throw new Error(parsed.error);
            if (parsed.text) {
              accumulated += parsed.text;
              if (onChunk) onChunk(parsed.text, accumulated);
            }
          } catch (e) {
            if (e.message !== 'Unexpected token') {
              hadError = true;
              if (onError) onError(e);
            }
          }
        }
      }

      // If the stream ended with an error event, don't also call onDone —
      // that would hand the caller an empty "success" (accumulated === '')
      // right after telling them why it failed, and callers that treat an
      // empty onDone as a generic "empty response" would silently discard
      // the real, specific error message above.
      if (!hadError && onDone) onDone(accumulated);
    } catch (err) {
      if (onError) onError(err);
    }
  }

  async function callAgent({ systemPrompt, messages, model }) {
    return new Promise((resolve, reject) => {
      streamResponse({
        systemPrompt,
        messages,
        model: model || 'gemini-2.5-pro',
        onDone:  (text) => resolve(text),
        onError: (err)  => reject(err),
      });
    });
  }

  return { streamResponse, callAgent };
})();
