/**
 * api/_lib/nancy-claude.js — shared forced-tool-call JSON helper for Nancy's
 * agent pipeline (website analyst, strategist, content planner, etc.).
 *
 * Streams the upstream call and accumulates the tool_use input server-side —
 * see api/generate-social-posts.js for why: a non-streaming request that
 * takes tens of seconds to produce one response is exactly the shape most
 * likely to get killed by an idle-connection timeout somewhere in the
 * network path, which reads as "the AI failed" even when it was still
 * generating. Same fix, reused here since every Nancy agent has this shape.
 */

'use strict';

const CLAUDE_MODEL = 'claude-sonnet-4-6';

/**
 * @param {object} opts
 * @param {string} opts.system - system prompt
 * @param {string|Array} opts.user - user message: a plain string, or an array
 *   of Anthropic content blocks (e.g. image + text) for vision input
 * @param {object} opts.tool - { name, description, input_schema } — JSON Schema for the forced tool call
 * @param {number} [opts.maxTokens]
 * @param {number} [opts.timeoutMs]
 * @returns {Promise<{success:true, data:object, usage:object} | {success:false, error:string}>}
 */
async function callClaudeForJSON({ system, user, tool, maxTokens = 4000, timeoutMs = 50000 }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { success: false, error: 'ANTHROPIC_API_KEY not configured' };

  let upstream;
  try {
    upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: maxTokens,
        system,
        tools: [tool],
        tool_choice: { type: 'tool', name: tool.name },
        stream: true,
        messages: [{ role: 'user', content: user }],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const isTimeout = err.name === 'TimeoutError' || err.name === 'AbortError';
    return { success: false, error: isTimeout ? 'Claude took too long to respond. Try again.' : err.message };
  }

  if (!upstream.ok) {
    const errData = await upstream.json().catch(() => ({}));
    return { success: false, error: errData.error?.message || `Anthropic error ${upstream.status}` };
  }

  let toolInputJson = '';
  let usage = null;
  let sawToolUse = false;
  let streamError = null;

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const processLine = (rawLine) => {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (!line.startsWith('data:')) return;
    const jsonStr = line.slice(5).trim();
    if (!jsonStr || jsonStr === '[DONE]') return;
    let payload;
    try { payload = JSON.parse(jsonStr); } catch { return; }

    if (payload.type === 'content_block_start' && payload.content_block?.type === 'tool_use') {
      sawToolUse = true;
    } else if (payload.type === 'content_block_delta' && payload.delta?.type === 'input_json_delta') {
      toolInputJson += payload.delta.partial_json || '';
    } else if (payload.type === 'message_start') {
      usage = payload.message?.usage || null;
    } else if (payload.type === 'message_delta') {
      usage = { ...(usage || {}), ...(payload.usage || {}) };
    } else if (payload.type === 'error') {
      streamError = payload.error?.message || 'Anthropic stream error';
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (value && value.length) buffer += decoder.decode(value, { stream: true });
    if (done) {
      buffer += decoder.decode();
      if (buffer) processLine(buffer);
      break;
    }
    let idx;
    while ((idx = buffer.indexOf('\n')) !== -1) {
      processLine(buffer.slice(0, idx));
      buffer = buffer.slice(idx + 1);
    }
  }

  if (streamError) return { success: false, error: streamError };
  if (!sawToolUse || !toolInputJson) return { success: false, error: 'Claude did not return structured output. Try again.' };

  try {
    return { success: true, data: JSON.parse(toolInputJson), usage };
  } catch {
    return { success: false, error: 'Claude returned malformed structured output. Try again.' };
  }
}

module.exports = { callClaudeForJSON, CLAUDE_MODEL };
