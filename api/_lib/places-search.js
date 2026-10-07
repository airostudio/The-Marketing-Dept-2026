/**
 * api/_lib/places-search.js — Google Places API (New) Text Search, split out
 * of api/blade-places-search.js so Blade's HTTP endpoint and Scotty's
 * server-side Blade pipeline (api/_lib/blade-pipeline.js) share one
 * implementation instead of each carrying a copy.
 *
 * See api/blade-places-search.js for why this uses the Places API rather
 * than scraping Google Maps.
 */

'use strict';

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

function normalizePlace(place) {
  return {
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
  };
}

/**
 * @param {string} apiKey
 * @param {{textQuery?: string, pageToken?: string}} query one of the two
 * @returns {Promise<{results: Array, nextPageToken: string|null}>}
 * @throws Error with `.status` set to the upstream HTTP status on a Places error
 */
async function searchPlaces(apiKey, { textQuery, pageToken } = {}) {
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
  if (!response.ok) {
    const err = new Error(data.error?.message || 'Places API error');
    err.status = response.status;
    throw err;
  }
  return { results: (data.places || []).map(normalizePlace), nextPageToken: data.nextPageToken || null };
}

module.exports = { searchPlaces, normalizePlace };
