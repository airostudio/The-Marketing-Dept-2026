/**
 * api/blade-find-owner.js — Blade: find a real person's first name to
 * address a shortlisted lead by, for the mail-merge audit workflow
 * ("find 100-150 plumbers, audit them, shortlist the best 50, find the
 * owner's name, generate a personalised observation, export a CSV").
 *
 * The lookup itself lives in api/_lib/owner-lookup.js — shared with
 * api/cron-sales-intel-sweep.js, which needs the identical grounded,
 * never-fabricating lookup without an internal HTTP round-trip to this
 * endpoint. See that file for the full reasoning.
 *
 * POST { businessName, suburb, country, website? }
 * Returns: { success, firstName: string, source: string|null }
 *   firstName is '' when nothing was confidently found — never a guess.
 */

'use strict';

const { requireUser } = require('./_lib/require-user.js');
const { withFailureReporting } = require('./_lib/report-failure.js');
const { rateLimited } = require('./_lib/rate-limit.js');
const { findOwnerName } = require('./_lib/owner-lookup.js');

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 20;

module.exports = withFailureReporting('api/blade-find-owner', async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = await requireUser(req, res);
  if (!auth) return;

  if (rateLimited(req, res, { name: 'blade-find-owner', max: RATE_LIMIT_MAX, windowMs: RATE_LIMIT_WINDOW_MS, auth })) return;

  if (!process.env.PERPLEXITY_API_KEY) return res.status(503).json({ error: 'PERPLEXITY_API_KEY is not configured.' });

  const { businessName, suburb, country, website } = req.body || {};
  if (!businessName || !String(businessName).trim()) return res.status(400).json({ error: 'businessName is required' });

  try {
    const result = await findOwnerName({ businessName, suburb, country, website });
    return res.json({ success: true, ...result });
  } catch (e) {
    // Distinct from "searched and confirmed nobody could be identified" —
    // that's a real, honest result (firstName: ''); this is our own lookup
    // failing, which the caller should retry rather than treat as a verdict.
    return res.status(502).json({ error: e.message });
  }
});
