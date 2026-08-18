/**
 * api/_lib/nancy-providers.js — swappable external-service adapters for Nancy
 * ("Jam Fancy"), the AI Instagram content platform.
 *
 * Not a Vercel route — api/_lib/ is excluded from routing. Every adapter
 * here follows the same contract: check its env var, and if missing, return
 * { available: false, reason } instead of throwing or faking a result. No
 * caller in the Nancy pipeline ever fabricates data when a provider is
 * unavailable — callers must check `available` and degrade honestly (skip
 * the step, note it to the user, keep going with what real data exists).
 *
 * Swap a provider by pointing its env var at a different service — nothing
 * else in the Nancy pipeline needs to change.
 */

'use strict';

// ── Search / research provider ──────────────────────────────────────────────
// Uses Perplexity Sonar (already integrated elsewhere in this app — see
// api/enrich-business.js, api/perplexity.js) because it does live web search
// AND returns real source citations in one call, which is exactly what
// "never invent companies, every one needs a real source URL" requires.
// A Tavily/Exa/Serper/Brave adapter could replace this by implementing the
// same { query } -> { answer, citations: [{url,title}] } contract.
async function searchProvider(query, { systemPrompt, maxTokens = 2000 } = {}) {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) {
    return { available: false, reason: 'PERPLEXITY_API_KEY not configured — live web research is unavailable.' };
  }

  const res = await fetch('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'sonar-pro',
      messages: [
        { role: 'system', content: systemPrompt || 'You are a rigorous market research analyst. Only report real, verifiable businesses and facts you can cite. Never invent a company or URL.' },
        { role: 'user', content: query },
      ],
      max_tokens: maxTokens,
      temperature: 0.2,
      stream: false,
    }),
    signal: AbortSignal.timeout(45000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    return { available: false, reason: `Perplexity error ${res.status}: ${errText.slice(0, 200)}` };
  }

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || '';
  const citations = data.citations || [];
  return { available: true, text, citations };
}

// ── Screenshot provider ──────────────────────────────────────────────────────
// Interface: given a URL, return a hosted image URL (or base64) of the
// rendered page. Any provider that exposes "give me a URL, get back a
// screenshot" fits this contract — Browserless, ScreenshotOne, urlbox, etc.
// Reads SCREENSHOT_API_KEY + SCREENSHOT_PROVIDER (defaults to screenshotone's
// simple GET-based API, the lowest-integration-effort option) so swapping
// providers is a two-env-var change, not a code change.
async function screenshotProvider(targetUrl) {
  const apiKey = process.env.SCREENSHOT_API_KEY;
  if (!apiKey) {
    return {
      available: false,
      reason: 'SCREENSHOT_API_KEY not configured — no live screenshot service is connected (e.g. ScreenshotOne, Browserless, urlbox). Brand colours will be extracted from raw HTML/CSS only.',
    };
  }

  const provider = (process.env.SCREENSHOT_PROVIDER || 'screenshotone').toLowerCase();

  try {
    if (provider === 'screenshotone') {
      // ScreenshotOne's access-key based GET API returns the image bytes directly.
      const params = new URLSearchParams({
        access_key: apiKey,
        url: targetUrl,
        viewport_width: '1440',
        viewport_height: '900',
        full_page: 'true',
        format: 'png',
        block_ads: 'true',
        block_cookie_banners: 'true',
        cache: 'true',
      });
      const res = await fetch(`https://api.screenshotone.com/take?${params.toString()}`, {
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) return { available: false, reason: `Screenshot provider error ${res.status}` };
      const buf = Buffer.from(await res.arrayBuffer());
      return { available: true, buffer: buf, mimeType: 'image/png' };
    }

    if (provider === 'browserless') {
      const endpoint = process.env.BROWSERLESS_ENDPOINT || 'https://chrome.browserless.io';
      const res = await fetch(`${endpoint}/screenshot?token=${encodeURIComponent(apiKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: targetUrl, options: { fullPage: true, type: 'png' }, viewport: { width: 1440, height: 900 } }),
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) return { available: false, reason: `Screenshot provider error ${res.status}` };
      const buf = Buffer.from(await res.arrayBuffer());
      return { available: true, buffer: buf, mimeType: 'image/png' };
    }

    return { available: false, reason: `Unknown SCREENSHOT_PROVIDER "${provider}" — supported: screenshotone, browserless.` };
  } catch (err) {
    return { available: false, reason: `Screenshot capture failed: ${err.message}` };
  }
}

// ── Image generation provider ────────────────────────────────────────────────
// For backgrounds/illustrations only — the Nancy rendering engine never asks
// a generative model to render exact text (see render-social-image.js's
// deterministic SVG text layer). Contract: { prompt, width, height } ->
// { buffer, mimeType }. Currently unconfigured by default; when
// IMAGE_GEN_API_KEY is absent, the rendering engine falls back to a
// programmatic gradient/pattern background derived from the brand palette,
// which is a legitimate on-brand result, not a placeholder.
async function imageGenProvider(prompt, { width = 1080, height = 1350 } = {}) {
  const apiKey = process.env.IMAGE_GEN_API_KEY;
  if (!apiKey) {
    return { available: false, reason: 'IMAGE_GEN_API_KEY not configured — using a programmatic brand-colour background instead of a generated one.' };
  }
  // Adapter left intentionally thin: point IMAGE_GEN_PROVIDER at a concrete
  // service (e.g. 'openai' for gpt-image, 'stability') once a key exists —
  // the rendering engine only needs { buffer, mimeType } back.
  return { available: false, reason: 'IMAGE_GEN_API_KEY is set but no provider implementation is wired yet — add one in api/_lib/nancy-providers.js#imageGenProvider.' };
}

module.exports = { searchProvider, screenshotProvider, imageGenProvider };
