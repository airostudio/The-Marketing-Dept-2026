/**
 * api/_lib/loadtest-calibration.js — the Load Testing Agent's ONE deliberate,
 * disclosed, real action.
 *
 * Not a Vercel route (api/_lib/ is excluded from routing) — imported only by
 * api/loadtest-create.js, and only ever invoked once per run, at creation
 * time, when the owner has opted in.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * WHAT THIS FILE DOES AND DOES NOT DO, PRECISELY:
 *
 *   It calls INTO api/generate-website-mockup.js — the existing, reviewed,
 *   credit-gated Gemini mockup generator built for Chase/Prospect Hunter —
 *   exactly once, to measure how long a real generation actually takes and
 *   what it actually costs in credits. It never talks to Gemini, Claude, or
 *   OpenAI directly, and never constructs a request to any real provider's
 *   API host itself (Google's Gemini host, Anthropic's, or OpenAI's — see
 *   tests/load-testing/run.js's BANNED_PATTERNS for the exact hostnames this
 *   is checked against). The real provider call stays fully encapsulated
 *   inside the
 *   already-reviewed generator module — see tests/load-testing/run.js for
 *   the assertion that enforces this.
 *
 *   It calls safeFetch() (api/_lib/safe-fetch.js) — never a raw fetch — for
 *   the one "does the built thing actually serve" check against the
 *   generator's returned imageUrl.
 *
 *   The result of this ONE call PARAMETERIZES the simulation (see
 *   loadtest-engine.js's computeCalibratedMuSeconds and the costUnit/
 *   costPerGenerationUsd fields it sets on the run's config) — it never
 *   itself runs any of the run's 24,820+ simulated jobs. Every one of those
 *   is still pure math in api/_lib/loadtest-engine.js, executed by
 *   api/cron-loadtest-tick.js, which makes zero network calls, exactly as
 *   before this feature existed.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ── Why "require the module and call its handler with a constructed
 *    req/res pair" instead of a real HTTP round-trip to this deployment's
 *    own /api/generate-website-mockup ──────────────────────────────────────
 *
 * This codebase already has exactly this pattern, just not in production
 * code yet: every test in tests/*.js (see tests/load-testing/run.js's own
 * `call()` helper, used two paragraphs up in this very feature's test suite)
 * requires an endpoint module directly and drives it with a plain
 * { method, headers, body, query } object and a { status, json, setHeader }
 * stub, because api/*.js handlers are already written as plain
 * `(req, res) => {}` functions with no framework-level coupling. Reusing
 * that same shape here means:
 *
 *   - No second network hop, no DNS lookup, no TLS handshake, and — this
 *     matters specifically for a LATENCY measurement — no added transport
 *     time getting counted as if it were part of the real generation's
 *     latency. Date.now() around a real HTTP call to our own deployment
 *     would measure "Gemini plus a trip through our own edge network," not
 *     "Gemini."
 *   - No need to know this deployment's own base URL. Vercel does not give
 *     a serverless function a fully reliable, protocol-correct URL for
 *     itself to call back into (VERCEL_URL is the deployment's preview/prod
 *     hostname, not guaranteed to be what a given invocation should trust,
 *     and custom domains complicate it further) — a same-process call sinks
 *     that whole class of "which URL do I call" fragility entirely.
 *   - No new internal-auth mechanism to invent, secure, and rotate. The
 *     generator's own auth (requireUser) is satisfied by forwarding the
 *     SAME Authorization header the original loadtest-create request
 *     already carried — the calibration call runs as the same real,
 *     already-authenticated operator who clicked "Start Test", not as some
 *     new internal service identity.
 *
 * The tradeoff, stated plainly: this only works because api/loadtest-create
 * and api/generate-website-mockup run in the SAME Node process (true for
 * every Vercel serverless invocation of a single function — there is no
 * multi-process boundary within one function to cross) and because
 * generate-website-mockup.js's handler was already written framework-free
 * (a plain (req, res) function with no dependency on being reached via HTTP
 * specifically, e.g. no reliance on Vercel-injected req properties beyond
 * headers/body/query). If that generator ever grew a hard dependency on
 * something only the real HTTP layer provides, this in-process call would
 * need to become a real HTTP call instead — which is exactly the same
 * decision tests/*.js already made and lives with.
 *
 * ── Credit-scope safety (preserved, verified) ───────────────────────────
 *
 * The constructed request body below NEVER includes intelProfileId or
 * projectId. Per generate-website-mockup.js's own documented behavior,
 * getOrCreateBalance() returns null when both are omitted, which skips the
 * entire credit-reservation gate — the call proceeds unmetered against no
 * customer's balance. That is exactly the property this feature needs: an
 * internal platform-calibration action must never be charged against a
 * random customer's credits. See tests/load-testing/run.js for the
 * assertion that the constructed request never carries either field.
 */

'use strict';

const { safeFetch } = require('./safe-fetch.js');

/** Every possible failure of this module's one real call is, by
 * construction, an image-generation (Gemini) failure — the mockup generator
 * has no other real-provider dependency to fail at, so this is the one
 * category from the simulation's own vocabulary
 * (claude_error/image_api_error/deployment_error/database_error) it could
 * ever honestly report. */
const CALIBRATION_FAILURE_CATEGORY = 'image_api_error';

/**
 * Build the minimal fake { req, res } pair the mockup generator's handler
 * needs, mirroring tests/load-testing/run.js's own call() helper.
 */
function buildFakeReqRes(originalReq, body) {
  let statusCode = 200;
  let jsonBody = null;
  const res = {
    headersSent: false,
    setHeader() {},
    status(code) { statusCode = code; return this; },
    json(payload) { jsonBody = payload; return this; },
    end() { return this; },
  };
  const req = {
    method: 'POST',
    // Forward only what requireUser/rateLimited actually read — the SAME
    // caller's own session, not a manufactured internal identity. No
    // intelProfileId/projectId is ever added to `body` by this function's
    // caller (see runCalibration below) — that is what keeps this call
    // unmetered against a real customer's balance.
    headers: {
      authorization: (originalReq && originalReq.headers && originalReq.headers['authorization']) || '',
      'x-real-ip': originalReq && originalReq.headers && originalReq.headers['x-real-ip'],
      'x-forwarded-for': originalReq && originalReq.headers && originalReq.headers['x-forwarded-for'],
    },
    body,
    query: {},
    socket: originalReq && originalReq.socket,
  };
  return { req, res, getResult: () => ({ status: statusCode, body: jsonBody }) };
}

/**
 * A user-supplied URL to serve-check must look like an actual http(s) URL
 * before it's worth handing to safeFetch at all — this is a shape check
 * only. safeFetch (api/_lib/safe-fetch.js) is what actually keeps a
 * malicious/internal target from being reached (DNS resolution + private/
 * reserved-range blocking on every hop, manual redirect re-validation) —
 * this function does not duplicate that, it just rejects obvious garbage
 * early with a clear error instead of a confusing safeFetch failure.
 */
function isPlausibleHttpUrl(u) {
  try {
    const parsed = new URL(u);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/** One real GET via the SSRF-hardened fetcher, timed and reported honestly either way. */
async function checkUrlServes(url) {
  const fetchStartedAt = Date.now();
  try {
    const r = await safeFetch(url, { method: 'GET', timeoutMs: 10000 });
    return {
      applicable: true,
      checkedUrl: url,
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      latencyMs: Date.now() - fetchStartedAt,
    };
  } catch (err) {
    return {
      applicable: true,
      checkedUrl: url,
      ok: false,
      status: null,
      latencyMs: Date.now() - fetchStartedAt,
      reason: (err && err.message) || 'The served-check request failed.',
    };
  }
}

/**
 * Run the ONE real calibration call for a new load test, and the ONE real
 * served-check that follows it. Never throws — every failure mode (the
 * generator call itself failing, or the served-check failing) is reported
 * back as { success: false, ... } for the caller to act on, per the task's
 * "refuse to start on a broken real pipeline" rule.
 *
 * @param {object} originalReq — the incoming loadtest-create request, used
 *   only to forward its Authorization header (see header comment above).
 * @param {string} businessName
 * @param {string} [industry]
 * @param {string} [targetUrl] — when given, the served-check verifies THIS
 *   URL instead of the generator's own returned imageUrl. Lets an operator
 *   ask "can the actual website I care about serve right now" rather than
 *   only "did the mockup image we just generated load" — the mockup image
 *   is still generated either way (that's what produces the real latency/
 *   cost being calibrated), targetUrl only changes what gets served-checked.
 * @returns {Promise<object>} the calibration_result shape stored on the run:
 *   { success, realLatencyMs, realCreditsUsed, failureCategory,
 *     failureMessage, servedCheck: {applicable, ok, status, latencyMs, reason, checkedUrl} }
 */
async function runCalibration(originalReq, { businessName, industry, targetUrl }) {
  const mockupHandler = require('../generate-website-mockup.js');

  const requestBody = {
    businessName,
    industry: industry || '',
    // Deliberately omitted: brandColors, tagline (not needed for a
    // calibration probe), and — the important omission — intelProfileId /
    // projectId. See the credit-scope-safety section of this file's header.
  };

  const { req, res, getResult } = buildFakeReqRes(originalReq, requestBody);

  const startedAt = Date.now();
  try {
    await mockupHandler(req, res);
  } catch (err) {
    return {
      success: false,
      realLatencyMs: Date.now() - startedAt,
      realCreditsUsed: null,
      failureCategory: CALIBRATION_FAILURE_CATEGORY,
      failureMessage: (err && err.message) || 'The calibration call threw unexpectedly.',
      servedCheck: { applicable: false, checkedUrl: null, reason: 'The calibration call failed before an image was produced.' },
    };
  }
  const realLatencyMs = Date.now() - startedAt; // measured here, never trusted from the response body

  const { status, body } = getResult();
  if (status !== 200 || !body || body.success !== true || !body.imageUrl) {
    return {
      success: false,
      realLatencyMs,
      realCreditsUsed: null,
      failureCategory: CALIBRATION_FAILURE_CATEGORY,
      failureMessage: (body && body.error) || `The calibration call failed (HTTP ${status}).`,
      servedCheck: { applicable: false, checkedUrl: null, reason: 'The calibration call failed before an image was produced.' },
    };
  }

  const realCreditsUsed = Number.isFinite(body.creditsUsed) ? body.creditsUsed : null;

  // ── The one real served-check, via the SSRF-hardened fetch primitive ────
  // Defaults to the mockup generator's own output; an operator-supplied
  // targetUrl checks that real website instead — the generation still runs
  // either way, since that's what produces the latency/cost being
  // calibrated, but "did the built mockup image load" and "does the actual
  // site I run load" are different questions, and only the second one is
  // useful when there's a real URL to ask it about.
  let servedCheck;
  const trimmedTargetUrl = typeof targetUrl === 'string' ? targetUrl.trim() : '';

  if (trimmedTargetUrl) {
    if (!isPlausibleHttpUrl(trimmedTargetUrl)) {
      servedCheck = {
        applicable: false,
        checkedUrl: trimmedTargetUrl,
        reason: `"${trimmedTargetUrl}" is not a valid http(s) URL — no served-check was attempted.`,
      };
    } else {
      servedCheck = await checkUrlServes(trimmedTargetUrl);
    }
  } else if (typeof body.imageUrl === 'string' && body.imageUrl.startsWith('data:')) {
    servedCheck = {
      applicable: false,
      checkedUrl: null,
      reason: 'R2 not configured — result was an inline data URI, nothing to fetch, and no targetUrl was supplied',
    };
  } else {
    servedCheck = await checkUrlServes(body.imageUrl);
  }

  return {
    success: true,
    realLatencyMs,
    realCreditsUsed,
    failureCategory: null,
    failureMessage: null,
    servedCheck,
  };
}

module.exports = { runCalibration, CALIBRATION_FAILURE_CATEGORY };
