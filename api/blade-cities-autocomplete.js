/**
 * api/blade-cities-autocomplete.js — Blade: city/town typeahead for a chosen
 * country, used to drill down from "country" to "local city or town" before
 * running a Google Maps business search.
 *
 * POST { input, countryCode }
 * Returns: { success, cities: [{ description, placeId }] }
 */

'use strict';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GOOGLE_PLACES_API_KEY not configured' });

  const { input, countryCode } = req.body || {};
  if (!input || !String(input).trim()) return res.json({ success: true, cities: [] });

  try {
    const response = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey },
      body: JSON.stringify({
        input: String(input).trim(),
        includedPrimaryTypes: ['locality', 'administrative_area_level_3'],
        ...(countryCode ? { includedRegionCodes: [countryCode] } : {}),
      }),
      signal: AbortSignal.timeout(8000),
    });
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: data.error?.message || 'Places Autocomplete error' });

    const cities = (data.suggestions || [])
      .map(s => s.placePrediction)
      .filter(Boolean)
      .map(p => ({ description: p.text?.text || '', placeId: p.placeId }));

    return res.json({ success: true, cities });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
