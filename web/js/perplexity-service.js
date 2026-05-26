/**
 * PerplexityService — frontend client for /api/perplexity (Sonar Pro)
 * Mirrors the ClaudeService interface: streamResponse() and callAgent()
 * Used by: Competitive Intelligence (SCOUT)
 *
 * Perplexity Sonar Pro has live web search built in — responses include
 * real-time competitor data with cited sources.
 */
window.PerplexityService = (function () {
  'use strict';

  async function streamResponse({ systemPrompt, messages, model, onChunk, onDone, onError, onCitations }) {
    try {
      const res = await fetch('/api/perplexity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages,
          systemPrompt,
          model: model || 'sonar-pro',
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
            if (parsed.citations && onCitations) {
              onCitations(parsed.citations);
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
        model: model || 'sonar-pro',
        onDone:  (text) => resolve(text),
        onError: (err)  => reject(err),
      });
    });
  }

  return { streamResponse, callAgent };
})();
