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

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 20;
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

const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.nationalPhoneNumber',
  'places.internationalPhoneNumber',
  'places.websiteUri',
  'places.rating',
  'places.userRatingCount',
  'places.businessStatus',
  'places.types',
  'places.googleMapsUri',
  'nextPageToken',
].join(',');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = getClientIp(req);
  if (!checkRateLimit(ip)) return res.status(429).json({ error: 'Too many requests. Slow down.' });

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GOOGLE_PLACES_API_KEY not configured' });

  const { sector, city, country, pageToken } = req.body || {};
  if (!pageToken && (!sector || !String(sector).trim())) return res.status(400).json({ error: 'sector is required' });
  if (!pageToken && (!city || !String(city).trim())) return res.status(400).json({ error: 'city is required' });

  const textQuery = pageToken
    ? undefined
    : `${String(sector).trim()} in ${String(city).trim()}${country ? ', ' + String(country).trim() : ''}`;

  try {
    const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': FIELD_MASK,
      },
      body: JSON.stringify({
        ...(textQuery ? { textQuery } : {}),
        ...(pageToken ? { pageToken } : {}),
        languageCode: 'en',
        pageSize: 20,
      }),
      signal: AbortSignal.timeout(15000),
    });

    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: data.error?.message || 'Places API error' });

    const results = (data.places || []).map(place => ({
      placeId: place.id,
      name: place.displayName?.text || '',
      address: place.formattedAddress || '',
      phone: place.nationalPhoneNumber || place.internationalPhoneNumber || '',
      website: place.websiteUri || '',
      rating: place.rating ?? null,
      reviewCount: place.userRatingCount ?? null,
      businessStatus: place.businessStatus || '',
      types: place.types || [],
      mapsUrl: place.googleMapsUri || '',
    }));

    return res.json({ success: true, results, nextPageToken: data.nextPageToken || null });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
