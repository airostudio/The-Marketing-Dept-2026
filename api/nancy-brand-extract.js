/**
 * api/nancy-brand-extract.js — Nancy Steps 3+4: Screenshot + Brand Identity
 *
 * POST { url: string }
 * Returns: {
 *   success, brand: {...brand identity schema...},
 *   screenshot: { available, dataUri?, hostedUrl?, reason? },
 * }
 *
 * Captures a live screenshot via the pluggable screenshot adapter (degrades
 * honestly if SCREENSHOT_API_KEY isn't set — never fakes one), extracts
 * candidate colours/fonts from raw HTML/CSS, and — when a screenshot is
 * available — sends it to Claude as a real vision input alongside the colour
 * candidates so the brand read reflects what the page actually LOOKS like,
 * not just CSS literals.
 */

'use strict';

const { crawlSite } = require('./_lib/nancy-crawl.js');
const { extractColours, extractFontHints } = require('./_lib/nancy-colours.js');
const { screenshotProvider } = require('./_lib/nancy-providers.js');
const { callClaudeForJSON, CLAUDE_MODEL } = require('./_lib/nancy-claude.js');
const { uploadToR2, isR2Configured } = require('./_lib/r2.js');

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 6;
const rateBuckets = new Map();

function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) return fwd.split(',')[0].trim();
  return req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
}
function checkRateLimit(ip) {
  const now = Date.now();
  let b = rateBuckets.get(ip);
  if (!b || now - b.windowStart > RATE_LIMIT_WINDOW_MS) { b = { windowStart: now, count: 0 }; rateBuckets.set(ip, b); }
  b.count++;
  return b.count <= RATE_LIMIT_MAX;
}

const BRAND_TOOL = {
  name: 'submit_brand_identity',
  description: 'Submit the site\'s intentional visual brand identity.',
  input_schema: {
    type: 'object',
    properties: {
      primary_colour: { type: 'string', description: 'Hex code, the single dominant intentional brand colour' },
      secondary_colours: { type: 'array', items: { type: 'string' } },
      accent_colours: { type: 'array', items: { type: 'string' } },
      background_colours: { type: 'array', items: { type: 'string' } },
      text_colours: { type: 'array', items: { type: 'string' } },
      heading_style: { type: 'string' },
      body_style: { type: 'string' },
      visual_style: { type: 'string', description: 'e.g. "minimal editorial", "bold and playful", "corporate premium"' },
      brand_personality: { type: 'array', items: { type: 'string' }, description: '3-5 adjectives' },
      image_style: { type: 'string' },
      design_notes: { type: 'string' },
    },
    required: ['primary_colour', 'secondary_colours', 'accent_colours', 'visual_style', 'brand_personality'],
  },
};

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = getClientIp(req);
  if (!checkRateLimit(ip)) return res.status(429).json({ error: 'Too many requests. Slow down.' });

  const { url } = req.body || {};
  if (!url) return res.status(400).json({ error: 'url is required' });

  let crawl;
  try {
    crawl = await crawlSite(url);
  } catch (err) {
    return res.status(422).json({ success: false, error: err.message });
  }
  if (!crawl.homepageHtml) {
    return res.status(422).json({ success: false, error: 'Could not fetch the homepage to inspect its CSS.' });
  }

  const colourCandidates = extractColours(crawl.homepageHtml);
  const fontHints = extractFontHints(crawl.homepageHtml);

  const shot = await screenshotProvider(crawl.origin);

  let screenshotResult = { available: false, reason: shot.reason };
  if (shot.available) {
    const dataUri = `data:${shot.mimeType};base64,${shot.buffer.toString('base64')}`;
    let hostedUrl = null;
    if (isR2Configured()) {
      try {
        hostedUrl = await uploadToR2(`nancy-screenshots/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`, shot.buffer, shot.mimeType);
      } catch (err) { console.warn('[nancy-brand-extract] R2 upload failed:', err.message); }
    }
    screenshotResult = { available: true, dataUri, hostedUrl };
  }

  const system = `You are a brand designer identifying a website's INTENTIONAL visual identity — the colours/style the designer chose to represent the brand, not just whatever pixels are most common. Prefer colours used on buttons, headings, and CTAs over incidental background greys. If a screenshot is provided, use it as the primary evidence of what the site actually looks like; use the colour candidates list as a hint, not gospel — override it if the screenshot shows something different.`;

  const colourHint = `Colour candidates extracted from this site's CSS (ranked by how intentionally-branded they look): ${colourCandidates.allCandidates.join(', ') || 'none found'}.\nFont hints found in CSS: ${fontHints.join(', ') || 'none found'}.`;

  const content = [{ type: 'text', text: `Website: ${crawl.origin}\n\n${colourHint}\n\nIdentify the brand's visual identity.` }];
  if (screenshotResult.available) {
    content.unshift({ type: 'image', source: { type: 'base64', media_type: shot.mimeType, data: shot.buffer.toString('base64') } });
  }

  // callClaudeForJSON only accepts a plain string `user` today — when a
  // screenshot is available we need multi-block content (image + text), so
  // build that request directly here rather than stretching the shared
  // helper's contract. Same streaming/accumulation logic, inlined.
  const result = await callClaudeVisionForJSON({ system, content, tool: BRAND_TOOL, maxTokens: 1500 });
  if (!result.success) {
    return res.status(502).json({ success: false, error: result.error, screenshot: screenshotResult });
  }

  return res.json({
    success: true,
    brand: { ...result.data, fonts_detected: fontHints },
    screenshot: screenshotResult,
  });
};

// Thin duplicate of callClaudeForJSON's streaming accumulator, but accepting
// multi-block message content (image + text) for vision input — kept local
// since this is the only Nancy endpoint that needs vision.
async function callClaudeVisionForJSON({ system, content, tool, maxTokens }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { success: false, error: 'ANTHROPIC_API_KEY not configured' };

  let upstream;
  try {
    upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: maxTokens,
        system,
        tools: [tool],
        tool_choice: { type: 'tool', name: tool.name },
        stream: true,
        messages: [{ role: 'user', content }],
      }),
      signal: AbortSignal.timeout(55000),
    });
  } catch (err) {
    return { success: false, error: err.name === 'TimeoutError' || err.name === 'AbortError' ? 'Claude took too long. Try again.' : err.message };
  }

  if (!upstream.ok) {
    const errData = await upstream.json().catch(() => ({}));
    return { success: false, error: errData.error?.message || `Anthropic error ${upstream.status}` };
  }

  let toolInputJson = '', sawToolUse = false, streamError = null;
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
    if (payload.type === 'content_block_start' && payload.content_block?.type === 'tool_use') sawToolUse = true;
    else if (payload.type === 'content_block_delta' && payload.delta?.type === 'input_json_delta') toolInputJson += payload.delta.partial_json || '';
    else if (payload.type === 'error') streamError = payload.error?.message || 'Anthropic stream error';
  };
  while (true) {
    const { done, value } = await reader.read();
    if (value && value.length) buffer += decoder.decode(value, { stream: true });
    if (done) { buffer += decoder.decode(); if (buffer) processLine(buffer); break; }
    let idx;
    while ((idx = buffer.indexOf('\n')) !== -1) { processLine(buffer.slice(0, idx)); buffer = buffer.slice(idx + 1); }
  }
  if (streamError) return { success: false, error: streamError };
  if (!sawToolUse || !toolInputJson) return { success: false, error: 'Claude did not return structured output.' };
  try { return { success: true, data: JSON.parse(toolInputJson) }; }
  catch { return { success: false, error: 'Malformed structured output.' }; }
}
