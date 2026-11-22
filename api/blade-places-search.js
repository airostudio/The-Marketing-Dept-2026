/**
 * api/blade-places-search.js — Blade: Google Maps business search for a
 * chosen sector inside a chosen city/town.
 *
 * POST { sector, city, country, pageToken? }
 * Returns: { success, results: [{ name, address, phone, website, rating,
 *   reviewCount, businessStatus, types, mapsUrl, placeId }], nextPageToken }
 *
 * Uses Places API (New) Text Search rather than scraping the Google Maps
 * front-end: the front-end is a moving JS target with no stable markup
 * contract and scraping it directly breaches Google's ToS, whereas the
 * Places API is the sanctioned, stable way to pull the same business data
 * (name/address/phone/website/rating) at scale.
 */

'use strict';

const { requireUser } = require('./_lib/require-user.js');
const { withFailureReporting } = require('./_lib/report-failure.js');
const { rateLimited } = require('./_lib/rate-limit.js');
const { searchPlaces } = require('./_lib/places-search.js');

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 20;



module.exports = withFailureReporting('api/blade-places-search', async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Every path below reaches a paid third party or this server's own crawler
  // on the account's credentials. Identify the caller before spending any of
  // it; a rate limit caps the speed, not the entitlement.
  const auth = await requireUser(req, res);
  if (!auth) return;

  if (rateLimited(req, res, { name: 'blade-places-search', max: 20, windowMs: 60 * 1000, auth })) return;

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GOOGLE_PLACES_API_KEY not configured' });

  const { sector, city, country, pageToken } = req.body || {};
  if (!pageToken && (!sector || !String(sector).trim())) return res.status(400).json({ error: 'sector is required' });
  if (!pageToken && (!city || !String(city).trim())) return res.status(400).json({ error: 'city is required' });

  const textQuery = pageToken
    ? undefined
    : `${String(sector).trim()} in ${String(city).trim()}${country ? ', ' + String(country).trim() : ''}`;

  try {
    const { results, nextPageToken } = await searchPlaces(apiKey, pageToken ? { pageToken } : { textQuery });
    return res.json({ success: true, results, nextPageToken });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message });
  }
});
