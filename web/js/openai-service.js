/**
 * OpenAIService — frontend client for /api/openai (GPT-4o)
 * Mirrors the ClaudeService/GeminiService interface: streamResponse() and callAgent()
 * Used by: Ad Creative Lab (BLAZE), Social Studio (PULSE)
 */
window.OpenAIService = (function () {
  'use strict';

  async function streamResponse({ systemPrompt, messages, model, onChunk, onDone, onError }) {
    try {
      const res = await fetch('/api/openai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages,
          systemPrompt,
          model: model || 'gpt-4o',
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
            if (onError && !(e instanceof SyntaxError)) onError(e);
          }
        }
      }

      if (onDone) onDone(accumulated);
    } catch (err) {
      if (onError) onError(err);
    }
  }

  async function callAgent({ systemPrompt, messages, model }) {
    return new Promise((resolve, reject) => {
      streamResponse({
        systemPrompt,
        messages,
        model: model || 'gpt-4o',
        onDone:  (text) => resolve(text),
        onError: (err)  => reject(err),
      });
    });
  }

  return { streamResponse, callAgent };
})();
