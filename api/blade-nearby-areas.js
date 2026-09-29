/**
 * api/blade-nearby-areas.js — Blade: resolve the suburbs and towns
 * surrounding a chosen city/town, so a search can cover a whole metro area
 * instead of just the one place someone typed.
 *
 * Reuses the same Places API (New) key Blade already spends
 * (blade-cities-autocomplete.js / blade-places-search.js) — no new provider,
 * no bundled suburbs dataset. Two calls: Place Details to turn the chosen
 * place's id into a lat/lng, then Nearby Search restricted to a circle
 * around it, filtered to locality-shaped place types.
 *
 * The radius is fixed, not a slider: 50km for the rest of the world, 30
 * miles for the handful of countries that still measure distance in miles.
 * Both are comfortably under Nearby Search's own 50,000m ceiling, which is
 * why 50km/30mi were the natural caps to offer rather than something larger.
 *
 * POST { placeId, countryCode }
 * Returns: { success, center: { name, lat, lng }, radiusMeters, unit,
 *   areas: [{ placeId, name, lat, lng, distanceKm }] }  (nearest first)
 */

'use strict';

const { requireUser } = require('./_lib/require-user.js');
const { withFailureReporting } = require('./_lib/report-failure.js');
const { rateLimited } = require('./_lib/rate-limit.js');

// The countries that still measure everyday distance in miles rather than
// km. Everyone else on Blade's country list gets the metric cap.
const IMPERIAL_COUNTRIES = new Set(['US', 'LR', 'MM']);
const MILES_TO_METERS = 1609.344;
const METRIC_RADIUS_METERS = 50000; // 50km — also Nearby Search's own max radius
const IMPERIAL_RADIUS_METERS = Math.round(30 * MILES_TO_METERS); // 30mi ≈ 48,280m

// Nearby Search's includedTypes only accepts the fixed vocabulary in Google's
// Table A (place categories, not address-component types) — sublocality,
// sublocality_level_1 and administrative_area_level_3 all 400 with
// "Unsupported types" because they're Table B/geocoding types, not Table A.
// locality IS in Table A and is what this needs anyway: in most of the
// countries Blade targets (Australia included) Google tags ordinary suburbs
// as locality too, not sublocality — sublocality mainly shows up for
// neighborhoods inside a handful of huge US/Asian cities.
const NEARBY_TYPES = ['locality'];

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

module.exports = withFailureReporting('api/blade-nearby-areas', async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Every path below reaches a paid third party on the account's
  // credentials. Identify the caller before spending any of it; a rate
  // limit caps the speed, not the entitlement.
  const auth = await requireUser(req, res);
  if (!auth) return;

  if (rateLimited(req, res, { name: 'blade-nearby-areas', max: 20, windowMs: 60 * 1000, auth })) return;

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GOOGLE_PLACES_API_KEY not configured' });

  const { placeId, countryCode } = req.body || {};
  if (!placeId || !String(placeId).trim()) return res.status(400).json({ error: 'placeId is required' });

  try {
    const detailsRes = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
      method: 'GET',
      headers: { 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': 'id,displayName,location' },
      signal: AbortSignal.timeout(8000),
    });
    const details = await detailsRes.json();
    if (!detailsRes.ok) return res.status(detailsRes.status).json({ error: details.error?.message || 'Place Details error' });

    const center = details.location;
    if (!center || center.latitude == null || center.longitude == null) {
      return res.status(502).json({ error: 'Google did not return a location for that place.' });
    }

    const imperial = IMPERIAL_COUNTRIES.has(String(countryCode || '').toUpperCase());
    const radiusMeters = imperial ? IMPERIAL_RADIUS_METERS : METRIC_RADIUS_METERS;

    const nearbyRes = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'places.id,places.displayName,places.location,places.types',
      },
      body: JSON.stringify({
        includedTypes: NEARBY_TYPES,
        maxResultCount: 20,
        languageCode: 'en',
        locationRestriction: { circle: { center: { latitude: center.latitude, longitude: center.longitude }, radius: radiusMeters } },
      }),
      signal: AbortSignal.timeout(10000),
    });
    const nearby = await nearbyRes.json();
    if (!nearbyRes.ok) return res.status(nearbyRes.status).json({ error: nearby.error?.message || 'Nearby Search error' });

    const areas = (nearby.places || [])
      .filter(p => p.id && p.id !== placeId && p.location)
      .map(p => ({
        placeId: p.id,
        name: p.displayName?.text || '',
        lat: p.location.latitude,
        lng: p.location.longitude,
        distanceKm: Math.round(haversineKm(center.latitude, center.longitude, p.location.latitude, p.location.longitude) * 10) / 10,
      }))
      .sort((a, b) => a.distanceKm - b.distanceKm);

    return res.json({
      success: true,
      center: { name: details.displayName?.text || '', lat: center.latitude, lng: center.longitude },
      radiusMeters,
      unit: imperial ? 'mi' : 'km',
      areas,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});
