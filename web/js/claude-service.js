/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * CLAUDE SERVICE — Audema - Your AI Marketing Department
 * Streaming AI responses via Claude claude-sonnet-4-6
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const ClaudeService = (() => {
  'use strict';

  const MODEL = 'claude-sonnet-4-6';
  const API_URL = 'https://api.anthropic.com/v1/messages';
  const MAX_TOKENS = 4096;

  function getApiKey() {
    return (
      window.CLAUDE_API_KEY ||
      (window.APP_CONFIG && window.APP_CONFIG.CLAUDE_API_KEY) ||
      localStorage.getItem('claude_api_key') ||
      ''
    );
  }

  /**
   * Stream a response from Claude into a DOM element.
   * @param {Object} opts
   * @param {string}   opts.systemPrompt  – system context for the agent
   * @param {Array}    opts.messages       – [{role, content}]
   * @param {Element}  opts.outputEl       – element to stream text into
   * @param {Function} [opts.onStart]      – called when stream begins
   * @param {Function} [opts.onChunk]      – called with each text chunk
   * @param {Function} [opts.onDone]       – called with full response text
   * @param {Function} [opts.onError]      – called with Error
   * @returns {Promise<string>}            – resolves with full response text
   */
  async function streamResponse({ systemPrompt, messages, outputEl, onStart, onChunk, onDone, onError }) {
    const apiKey = getApiKey();

    if (outputEl) outputEl.textContent = '';

    let fullText = '';

    try {
      if (onStart) onStart();

      const body = {
        model: MODEL,
        max_tokens: MAX_TOKENS,
        stream: true,
        messages: messages || [],
      };
      if (systemPrompt) body.system = systemPrompt;

      let response;
      if (apiKey) {
        response = await fetch(API_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true',
          },
          body: JSON.stringify(body),
        });
      } else {
        throw new Error('No Claude API key configured. Add your key via Settings or set window.CLAUDE_API_KEY.');
      }

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error?.message || `API error ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);
            if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
              const text = parsed.delta.text;
              fullText += text;
              if (outputEl) outputEl.textContent = fullText;
              if (onChunk) onChunk(text, fullText);
            }
          } catch (_) {
            // ignore parse errors on partial lines
          }
        }
      }

      if (onDone) onDone(fullText);
      return fullText;

    } catch (err) {
      const msg = `Error: ${err.message}`;
      if (outputEl) outputEl.textContent = msg;
      if (onError) onError(err);
      throw err;
    }
  }

  /**
   * Single-shot (non-streaming) call to Claude.
   * @param {Object} opts
   * @param {string}  opts.systemPrompt
   * @param {Array}   opts.messages
   * @returns {Promise<string>}
   */
  async function callAgent({ systemPrompt, messages }) {
    const apiKey = getApiKey();
    if (!apiKey) throw new Error('No Claude API key configured.');

    const body = {
      model: MODEL,
      max_tokens: MAX_TOKENS,
      messages: messages || [],
    };
    if (systemPrompt) body.system = systemPrompt;

    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error?.message || `API error ${response.status}`);
    }

    const data = await response.json();
    return data.content?.[0]?.text || '';
  }

  /**
   * Set API key at runtime.
   */
  function setApiKey(key) {
    window.CLAUDE_API_KEY = key;
    localStorage.setItem('claude_api_key', key);
  }

  return { streamResponse, callAgent, setApiKey, getApiKey };
})();

window.ClaudeService = ClaudeService;
