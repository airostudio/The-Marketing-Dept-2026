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
async function searchProvider(query, { systemPrompt, maxTokens = 1500 } = {}) {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) {
    return { available: false, reason: 'PERPLEXITY_API_KEY not configured — live web research is unavailable.' };
  }

  try {
    // This is the only slow call inside api/nancy-search-competitors.js —
    // the structuring step that used to run in the same invocation now
    // lives in its own function (api/nancy-structure-competitors.js), so
    // this gets a generous standalone budget instead of splitting one 60s
    // function ceiling two ways.
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
      signal: AbortSignal.timeout(50000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return { available: false, reason: `Perplexity error ${res.status}: ${errText.slice(0, 200)}` };
    }

    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || '';
    const citations = data.citations || [];
    return { available: true, text, citations };
  } catch (err) {
    // A timeout/network failure here must never throw — every Nancy caller
    // relies on the "always returns {available, reason}, never throws"
    // contract documented at the top of this file. An uncaught rejection
    // would crash the whole handler with a non-JSON response instead of a
    // real error message.
    const isTimeout = err.name === 'TimeoutError' || err.name === 'AbortError';
    return { available: false, reason: isTimeout ? 'Perplexity request timed out.' : `Perplexity request failed: ${err.message}` };
  }
}

// ── Screenshot provider ──────────────────────────────────────────────────────
// Interface: given a URL, return a hosted image URL (or base64) of the
// rendered page. Any provider that exposes "give me a URL, get back a
// screenshot" fits this contract. Defaults to screenshotlayer (apilayer) —
// Nancy's designated screenshot provider. ScreenshotOne/Browserless remain
// as swap-in alternatives via SCREENSHOT_PROVIDER, since the whole point of
// this adapter layer is that no other file needs to change to switch.
// Reads SCREENSHOT_API_KEY + SCREENSHOT_PROVIDER so swapping providers is a
// two-env-var change, not a code change.
async function screenshotProvider(targetUrl) {
  const apiKey = process.env.SCREENSHOT_API_KEY;
  if (!apiKey) {
    return {
      available: false,
      reason: 'SCREENSHOT_API_KEY not configured — no live screenshot service is connected (screenshotlayer by default). Brand colours will be extracted from raw HTML/CSS only.',
    };
  }

  const provider = (process.env.SCREENSHOT_PROVIDER || 'screenshotlayer').toLowerCase();

  try {
    if (provider === 'screenshotlayer') {
      // screenshotlayer (apilayer) — https://screenshotlayer.com/documentation
      // GET-only: success returns raw image bytes; failure returns 200 OK
      // with a JSON body ({success:false, error:{code,type,info}}), so the
      // only reliable way to tell them apart is the response Content-Type,
      // not the HTTP status.
      const FORMAT_MIME = { PNG: 'image/png', JPG: 'image/jpeg', GIF: 'image/gif', WEBP: 'image/webp' };
      const format = 'PNG';
      const params = new URLSearchParams({
        access_key: apiKey,
        url: targetUrl,
        viewport: '1440x900',
        fullpage: '1',
        format,
        force: '1', // bypass screenshotlayer's own cache — Nancy wants the live current page
      });
      const res = await fetch(`https://api.screenshotlayer.com/api/capture?${params.toString()}`, {
        signal: AbortSignal.timeout(40000),
      });

      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json') || contentType.includes('text/')) {
        const body = await res.json().catch(() => null);
        const info = body?.error?.info || body?.error?.type || `HTTP ${res.status}`;
        return { available: false, reason: `screenshotlayer error: ${info}` };
      }
      if (!res.ok) return { available: false, reason: `screenshotlayer error ${res.status}` };

      const buf = Buffer.from(await res.arrayBuffer());
      if (!buf.length) return { available: false, reason: 'screenshotlayer returned an empty response' };
      return { available: true, buffer: buf, mimeType: FORMAT_MIME[format] || 'image/png' };
    }

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
        signal: AbortSignal.timeout(40000),
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
        signal: AbortSignal.timeout(40000),
      });
      if (!res.ok) return { available: false, reason: `Screenshot provider error ${res.status}` };
      const buf = Buffer.from(await res.arrayBuffer());
      return { available: true, buffer: buf, mimeType: 'image/png' };
    }

    return { available: false, reason: `Unknown SCREENSHOT_PROVIDER "${provider}" — supported: screenshotlayer, screenshotone, browserless.` };
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
