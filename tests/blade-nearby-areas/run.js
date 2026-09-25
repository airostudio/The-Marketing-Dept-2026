/**
 * Blade used to support exactly one city per search — running it against a
 * whole metro area meant manually repeating the 4-step wizard once per
 * suburb. api/blade-nearby-areas.js is the new piece that makes "search this
 * area AND everywhere around it" possible: given a place someone already
 * picked, it resolves the towns/suburbs within a fixed radius of it using
 * the same Places API (New) key Blade already spends.
 *
 * What this pins:
 *
 *   The radius is fixed by country, not user-adjustable: 50km almost
 *   everywhere, 30 miles for the handful of countries that still measure
 *   distance in miles (US, Liberia, Myanmar). Both sit under Nearby Search's
 *   own 50,000m ceiling, which is why those exact numbers were chosen rather
 *   than something rounder.
 *
 *   The origin place itself is excluded from the result — it was the center
 *   of the search, not a "nearby" area.
 *
 *   Results come back nearest-first, since that's how a human actually
 *   wants to scan a list of 15+ suburbs before deciding which to keep.
 *
 *   A malformed or missing location from Google Place Details is a clear
 *   502, not a crash or a false-empty result.
 *
 *   node tests/blade-nearby-areas/run.js
 */
'use strict';

const path = require('path');
let failures = 0;
function check(label, ok) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failures++;
}

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test-key';
process.env.GOOGLE_PLACES_API_KEY = 'test-places-key';

// requireUser / rateLimited are exercised by their own dedicated suites —
// stub them here so this suite is only about the geo logic in this file.
const requireUserPath = require.resolve(path.join(__dirname, '..', '..', 'api/_lib/require-user.js'));
require.cache[requireUserPath] = {
  id: requireUserPath, filename: requireUserPath, loaded: true,
  exports: { requireUser: async () => ({ id: 'caller-1', email: 'a@x.com' }) },
};
const rateLimitPath = require.resolve(path.join(__dirname, '..', '..', 'api/_lib/rate-limit.js'));
require.cache[rateLimitPath] = {
  id: rateLimitPath, filename: rateLimitPath, loaded: true,
  exports: { rateLimited: () => false },
};

const handlerPath = path.join(__dirname, '..', '..', 'api/blade-nearby-areas.js');
delete require.cache[require.resolve(handlerPath)];
const handler = require(handlerPath);

function makeReq(body) { return { method: 'POST', headers: { authorization: 'Bearer t' }, body }; }
function makeRes() {
  const res = { statusCode: 200 };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (d) => { res.body = d; return res; };
  res.setHeader = () => {};
  res.end = () => res;
  return res;
}

const SYDNEY = { id: 'place-sydney', displayName: { text: 'Sydney NSW' }, location: { latitude: -33.8688, longitude: 151.2093 } };
// Roughly-plausible nearby suburbs at increasing distance from Sydney CBD.
const PARRAMATTA = { id: 'place-parramatta', displayName: { text: 'Parramatta' }, location: { latitude: -33.8150, longitude: 151.0011 } };
const PENRITH = { id: 'place-penrith', displayName: { text: 'Penrith' }, location: { latitude: -33.7511, longitude: 150.6942 } };

let lastNearbyBody = null;

function mockFetch({ details, nearby }) {
  return async (url, opts) => {
    const u = String(url);
    if (u.includes('/v1/places/')) {
      return { ok: true, json: async () => details };
    }
    if (u.includes(':searchNearby')) {
      lastNearbyBody = JSON.parse(opts.body);
      return { ok: true, json: async () => nearby };
    }
    throw new Error('Unmocked fetch: ' + u);
  };
}

(async () => {
  console.log('\n──── resolves nearby suburbs, nearest first, excluding the origin itself ────');
  {
    global.fetch = mockFetch({
      details: SYDNEY,
      nearby: { places: [PENRITH, SYDNEY, PARRAMATTA] }, // deliberately unsorted, origin included
    });
    const res = makeRes();
    await handler(makeReq({ placeId: 'place-sydney', countryCode: 'AU' }), res);
    check('the request succeeds', res.statusCode === 200 && res.body.success === true);
    check('the origin place is excluded from its own "nearby" list',
      !res.body.areas.some(a => a.placeId === 'place-sydney'));
    check('results are ordered nearest-first',
      res.body.areas.length === 2 && res.body.areas[0].distanceKm <= res.body.areas[1].distanceKm);
    check('Parramatta (closer) sorts before Penrith (further)',
      res.body.areas[0].name === 'Parramatta' && res.body.areas[1].name === 'Penrith');
    check('a metric country gets the 50km radius', res.body.unit === 'km' && res.body.radiusMeters === 50000);
    check('the request to Nearby Search actually used that radius',
      lastNearbyBody.locationRestriction.circle.radius === 50000);
  }

  console.log('\n──── an imperial country (US) gets a 30-mile radius instead ────');
  {
    global.fetch = mockFetch({ details: SYDNEY, nearby: { places: [] } });
    const res = makeRes();
    await handler(makeReq({ placeId: 'place-sydney', countryCode: 'US' }), res);
    check('unit is miles', res.body.unit === 'mi');
    check('radius is 30 miles in meters (not 50km)', res.body.radiusMeters === 48280);
    check('30mi radius is still under Nearby Search\'s own 50,000m ceiling', res.body.radiusMeters < 50000);
  }

  console.log('\n──── no country given falls back to the metric default ────');
  {
    global.fetch = mockFetch({ details: SYDNEY, nearby: { places: [] } });
    const res = makeRes();
    await handler(makeReq({ placeId: 'place-sydney' }), res);
    check('defaults to km when no country is known', res.body.unit === 'km' && res.body.radiusMeters === 50000);
  }

  console.log('\n──── Google returning no usable location is a clear error, not a silent empty result ────');
  {
    global.fetch = mockFetch({ details: { id: 'place-x', displayName: { text: 'X' } }, nearby: { places: [] } });
    const res = makeRes();
    await handler(makeReq({ placeId: 'place-x', countryCode: 'AU' }), res);
    check('a 502 is returned', res.statusCode === 502);
  }

  console.log('\n──── missing placeId is rejected before any Google call ────');
  {
    let called = false;
    global.fetch = async () => { called = true; return { ok: true, json: async () => ({}) }; };
    const res = makeRes();
    await handler(makeReq({ countryCode: 'AU' }), res);
    check('a 400 is returned', res.statusCode === 400);
    check('no request was made to Google', !called);
  }

  console.log(failures === 0 ? '\nALL ASSERTIONS PASSED\n' : `\n${failures} FAILED\n`);
  process.exit(failures === 0 ? 0 : 1);
})();
