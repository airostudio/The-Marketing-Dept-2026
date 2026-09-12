/**
 * api/tech-detect.js — thin route wrapper exposing api/_lib/tech-detect.js's
 * detectTechnology() alone, for callers that just want the platform without
 * paying for a full audit (e.g. a quick filter pass across many candidates
 * before running api/sales-audit-lead.js only on the survivors).
 *
 * POST { url }
 * Returns: { success, available, checked, technologies: [...], reason? }
 */

'use strict';

const { requireUser } = require('./_lib/require-user.js');
const { withFailureReporting } = require('./_lib/report-failure.js');
const { rateLimited } = require('./_lib/rate-limit.js');
const { detectTechnology } = require('./_lib/tech-detect.js');

module.exports = withFailureReporting('api/tech-detect', async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // This fetches a caller-supplied URL server-side (through safe-fetch) —
  // identify the caller before spending any of that, same as every other
  // endpoint that reaches out on the account's behalf.
  const auth = await requireUser(req, res);
  if (!auth) return;

  if (rateLimited(req, res, { name: 'tech-detect', max: 15, windowMs: 60 * 1000, auth })) return;

  const { url } = req.body || {};
  if (!url || !String(url).trim()) return res.status(400).json({ error: 'url is required' });

  const result = await detectTechnology(String(url).trim());
  return res.json({ success: true, ...result });
});
