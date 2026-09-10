/**
 * api/generate-website-mockup.js
 * Vercel serverless function — generates a single, illustrative "what a new
 * website for this business could look like" concept image via Gemini, for
 * the Prospect Hunter feature inside the Sales Intelligence agent (Chase).
 *
 * This is a visual teaser for cold outreach, not a rendering of the
 * business's real site: it is built only from a name, an optional industry,
 * and optional brand colors/tagline. It must never be presented — here or in
 * the outreach it gets inserted into — as reflecting the business's actual
 * logo, photography, or current content. See buildMockupPrompt() below,
 * which bakes that instruction into the generation prompt itself.
 *
 * Body: {
 *   businessName: string,     // required
 *   industry?: string,        // free text
 *   brandColors?: string[],   // hex strings, e.g. ["#1a73e8", "#ffffff"] —
 *                              // caller-supplied; sales-audit-lead.js also
 *                              // now returns a best-effort brandColors field
 *                              // from the audited homepage, but this
 *                              // endpoint never requires it and never
 *                              // fetches the site itself.
 *   tagline?: string,         // short string, e.g. from the audited site's meta description
 *   intelProfileId?: string,  // credit-metering scope (see below)
 *   projectId?: string,       // credit-metering scope, used when no active profile
 * }
 *
 * Returns: { success, imageUrl, hosted, mimeType, creditsUsed, creditsRemaining, notes }
 * On quota exhaustion: 402 { error: 'out_of_credits', message, creditsRemaining: 0, creditsRequired, upgradeUrl }
 *
 * ── Credit metering ──────────────────────────────────────────────────────
 * Reuses the exact same credit_balances ledger and consume_credits()/
 * refund_credits() RPCs as api/generate-ad-image.js — same balance pool per
 * intelligence profile/project, just a distinct per-call cost
 * (WEBSITE_MOCKUP_CREDIT_COST, default 50 — half of AD_IMAGE_CREDIT_COST's
 * default 100, since this generates one simpler concept image rather than a
 * full finished ad creative with baked-in typography). New scopes start with
 * DEFAULT_CREDIT_BALANCE credits, the same env var generate-ad-image.js
 * already reads — one shared balance, spent by either feature.
 */

'use strict';

const { imageGenProvider } = require('./_lib/nancy-providers.js');
const { uploadToR2, isR2Configured } = require('./_lib/r2.js');
const { withFailureReporting } = require('./_lib/report-failure.js');
const { requireUser, callerOwnsScope } = require('./_lib/require-user.js');
const { rateLimited } = require('./_lib/rate-limit.js');

const DISCLAIMER = 'AI-generated concept — an illustrative example only, not built from this business\'s actual content or logo.';

function buildMockupPrompt({ businessName, industry, brandColors, tagline }) {
  const colours = Array.isArray(brandColors) ? brandColors.filter(Boolean).slice(0, 4) : [];
  const colourLine = colours.length
    ? `Use this brand color palette throughout the design: ${colours.join(', ')}.`
    : '';

  const lines = [
    `Create a single, modern, professional website homepage HERO-SECTION DESIGN CONCEPT for a business called "${businessName}"${industry ? ` in the ${industry} industry` : ''}.`,
    colourLine,
    tagline ? `A short line of supporting copy may echo the general spirit of this (do not treat it as verbatim text that must appear on the design): "${tagline}".` : '',
    `This is a generic, illustrative REDESIGN CONCEPT ONLY — a stylistic example of what a clean, modern, professionally designed website could look like for a business like this one. Do NOT attempt to render this business's actual real logo, any specific real product photography, or copy any exact real content you do not have. Invent a plausible, generic, on-brand look instead — placeholder headline wording is fine as long as it reads as real, legible, correctly-spelled text rather than lorem-ipsum gibberish.`,
    `Show a realistic hero-section composition, landscape orientation, suited to a website: a clean navigation bar, a strong headline, a supporting hero image or illustration, and one clear call-to-action button.`,
    `Modern, premium web-design aesthetic — confident typography, generous whitespace, high contrast between text and background, a layout that reads as mobile-friendly.`,
    `No watermarks, no garbled or duplicated text, no visible AI-generation artifacts.`,
  ];
  return lines.filter(Boolean).join('\n');
}

// ── Credit metering (Supabase-backed, per intelligence profile/site) ───────
// Same ledger and RPCs as api/generate-ad-image.js — a distinct cost
// constant, not a second metering mechanism.
const WEBSITE_MOCKUP_CREDIT_COST = parseInt(process.env.WEBSITE_MOCKUP_CREDIT_COST, 10) || 50;
const DEFAULT_CREDIT_BALANCE = parseInt(process.env.DEFAULT_CREDIT_BALANCE, 10) || 20000;

async function sb(supabaseUrl, serviceKey, method, path, body) {
  const res = await fetch(`${supabaseUrl}/rest/v1${path}`, {
    method,
    headers: {
      'apikey': serviceKey,
      'Authorization': `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      'Prefer': method === 'POST' ? 'return=representation,resolution=merge-duplicates' : 'return=representation',
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Supabase ${method} ${path} failed (${res.status}): ${errText}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

/** Fetches (or lazily creates) the credit balance row for a scope. Returns null if metering isn't configured/applicable. */
async function getOrCreateBalance({ supabaseUrl, serviceKey, intelProfileId, projectId }) {
  if (!supabaseUrl || !serviceKey || (!intelProfileId && !projectId)) return null;

  const filter = intelProfileId ? `intel_profile_id=eq.${intelProfileId}` : `project_id=eq.${projectId}`;
  const existing = await sb(supabaseUrl, serviceKey, 'GET', `/credit_balances?${filter}&select=*&limit=1`);
  if (existing && existing.length) return existing[0];

  const created = await sb(supabaseUrl, serviceKey, 'POST', '/credit_balances', {
    intel_profile_id: intelProfileId || null,
    project_id: intelProfileId ? null : (projectId || null),
    credits_total: DEFAULT_CREDIT_BALANCE,
    credits_used: 0,
  });
  return Array.isArray(created) ? created[0] : created;
}

/**
 * Reserve the cost of one mockup, atomically — see generate-ad-image.js's
 * reserveCredits() for why this has to be a single database statement rather
 * than a read-compare-then-write straddling the (slow) Gemini call.
 */
async function reserveCredits({ supabaseUrl, serviceKey, intelProfileId, projectId, cost }) {
  const rows = await sb(supabaseUrl, serviceKey, 'POST', '/rpc/consume_credits', {
    pid: projectId || null, ipid: intelProfileId || null, cost,
  });
  const r = (Array.isArray(rows) ? rows[0] : rows) || {};
  return { allowed: r.allowed === true, used: r.used_after || 0, total: r.total || 0 };
}

/** Give back a reservation for a generation that failed. Clamped at zero DB-side. */
async function refundCredits({ supabaseUrl, serviceKey, intelProfileId, projectId, cost }) {
  await sb(supabaseUrl, serviceKey, 'POST', '/rpc/refund_credits', {
    pid: projectId || null, ipid: intelProfileId || null, cost,
  });
}

module.exports = withFailureReporting('api/generate-website-mockup', async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // A real external image-generation call on the account's Gemini key.
  // Identify the caller before spending any of it.
  const auth = await requireUser(req, res);
  if (!auth) return;

  // Tighter than most bounded work here — a real external image-gen call.
  if (rateLimited(req, res, { name: 'generate-website-mockup', max: 8, windowMs: 60 * 1000, auth })) return;

  const {
    businessName, industry = '', brandColors = null, tagline = '',
    intelProfileId = null, projectId = null,
  } = req.body || {};

  if (!businessName || !String(businessName).trim()) {
    return res.status(400).json({ error: 'businessName is required' });
  }
  if (brandColors !== null && !Array.isArray(brandColors)) {
    return res.status(400).json({ error: 'brandColors must be an array of hex strings, if provided' });
  }

  // A credit scope in the request body is only as safe as this check —
  // without it, any signed-in caller could bill another customer's balance.
  if (!(await callerOwnsScope(auth.userId, { intelProfileId, projectId }))) {
    return res.status(403).json({
      error: 'That business is not yours to bill.',
      code: 'scope_forbidden',
    });
  }

  // ── Credit gate — checked before spending anything on the Gemini call ──
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  let balance = null;
  try {
    balance = await getOrCreateBalance({ supabaseUrl, serviceKey, intelProfileId, projectId });
  } catch (err) {
    // A named scope must be honoured or the call must stop — a database
    // blip must never silently turn metering off.
    console.error('[generate-website-mockup] credit balance lookup failed:', err.message);
    if (intelProfileId || projectId) {
      return res.status(503).json({
        error: 'Could not check your image credits, so nothing was generated. Try again shortly.',
        code: 'credits_unavailable',
      });
    }
  }

  // Reserve the cost now, atomically, so concurrent calls on the same
  // balance cannot all pass a comparison against the same pre-spend figure.
  let reserved = false;
  if (balance) {
    let reservation;
    try {
      reservation = await reserveCredits({
        supabaseUrl, serviceKey, intelProfileId, projectId, cost: WEBSITE_MOCKUP_CREDIT_COST,
      });
    } catch (err) {
      console.error('[generate-website-mockup] credit reservation failed:', err.message);
      return res.status(503).json({
        error: 'Could not reserve your image credits, so nothing was generated. Try again shortly.',
        code: 'credits_unavailable',
      });
    }
    if (!reservation.allowed) {
      const remaining = Math.max(0, reservation.total - reservation.used);
      return res.status(402).json({
        error: 'out_of_credits',
        message: `This site is out of AI image credits (${remaining} of ${reservation.total} remaining). Upgrade to keep generating website mockups.`,
        creditsRemaining: remaining,
        creditsRequired: WEBSITE_MOCKUP_CREDIT_COST,
        creditsTotal: reservation.total,
        upgradeUrl: '/index.html#pricing',
      });
    }
    reserved = true;
    balance = { credits_total: reservation.total, credits_used: reservation.used, id: balance.id };
  }

  /** Hand back the reservation when the mockup never arrives. */
  const releaseReservation = async () => {
    if (!reserved) return;
    reserved = false;
    try {
      await refundCredits({ supabaseUrl, serviceKey, intelProfileId, projectId, cost: WEBSITE_MOCKUP_CREDIT_COST });
    } catch (err) {
      console.error('[generate-website-mockup] credit refund failed — the customer was charged for a mockup they did not get:', err.message);
    }
  };

  const prompt = buildMockupPrompt({ businessName: String(businessName).trim(), industry, brandColors, tagline });

  let gen;
  try {
    // Pinned to 'gemini' regardless of this deployment's IMAGE_GEN_PROVIDER
    // default — the user asked for this feature specifically via Gemini.
    gen = await imageGenProvider(prompt, { width: 1536, height: 1024, provider: 'gemini' });
  } catch (err) {
    // imageGenProvider's contract is "never throws" — this is defense in
    // depth only, so a genuine bug there still comes back as JSON.
    await releaseReservation();
    return res.status(500).json({ error: err.message || 'Image generation failed unexpectedly.' });
  }

  if (!gen.available) {
    await releaseReservation();
    // A missing/misconfigured key is this deployment's problem and reads
    // like the analogous 500 in api/generate-ad-image.js / api/gemini.js;
    // anything else (safety block, empty response, upstream error) is the
    // provider declining this particular request, which is a 502.
    const isConfigIssue = /not configured/i.test(gen.reason || '');
    return res.status(isConfigIssue ? 500 : 502).json({ error: gen.reason || 'Website mockup generation failed.' });
  }

  let imageUrl = null;
  let hosted = false;
  if (isR2Configured()) {
    try {
      imageUrl = await uploadToR2(
        `website-mockups/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${gen.mimeType === 'image/jpeg' ? 'jpg' : 'png'}`,
        gen.buffer,
        gen.mimeType,
      );
      hosted = !!imageUrl;
    } catch (err) {
      // R2 is configured but the upload itself failed — an honest error, not
      // a fabricated success, per the same rule as a failed Gemini call.
      await releaseReservation();
      return res.status(500).json({ error: `Mockup image was generated but could not be hosted: ${err.message}` });
    }
  }

  // R2 not configured at all: fall back to a data URI rather than hard-
  // failing — the same precedent api/nancy-screenshot.js already sets for
  // "no hosting configured, still hand back something real". A hero-section
  // concept image is well within a reasonable inline-response size.
  if (!imageUrl) {
    imageUrl = `data:${gen.mimeType};base64,${gen.buffer.toString('base64')}`;
  }

  reserved = false; // the reservation stands — this is a real, delivered image
  const creditsRemaining = balance
    ? Math.max(0, balance.credits_total - balance.credits_used)
    : undefined;

  return res.json({
    success: true,
    imageUrl,
    hosted,
    mimeType: gen.mimeType,
    creditsUsed: WEBSITE_MOCKUP_CREDIT_COST,
    creditsRemaining,
    disclaimer: DISCLAIMER,
    notes: [
      DISCLAIMER,
      ...(hosted
        ? []
        : (isR2Configured()
            ? []
            : ['R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_BUCKET_NAME not configured — imageUrl is an inline data URI rather than a hosted link.'])),
    ],
  });
});
