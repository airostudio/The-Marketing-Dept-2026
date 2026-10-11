/**
 * api/_lib/apollo-client.js — Apollo.io REST API client, split out of
 * api/apollo-enrich.js so api/_lib/owner-lookup.js (and anything else
 * server-side) can call it directly without an internal HTTP round-trip.
 *
 * See api/apollo-enrich.js for the full reasoning. Apollo's job here is
 * real people at a real domain — never a guess, and never backfilled with
 * an invented email (Apollo's search endpoint doesn't return email at all;
 * that's a separate, credit-costing enrich call this does not make).
 *
 * People search uses Apollo's API-key endpoint, mixed_people/api_search.
 * It returns a person's first name and title but only an obscured last name
 * ("Sm***h") and no LinkedIn link. The full name is shown only when Apollo
 * actually returns it; an obscured one is never passed off as real.
 */

'use strict';

const APOLLO_API_BASE = 'https://api.apollo.io/api/v1';
const DEFAULT_TITLES = ['Owner', 'Founder', 'Co-Founder', 'President', 'CEO', 'Managing Director', 'General Manager'];

function cleanDomain(raw) {
  return (raw || '')
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '')
    .replace(/^www\./, '')
    .toLowerCase()
    .trim();
}

/**
 * @returns {Promise<{found: boolean, people: Array<{name, firstName, title, linkedinUrl}>}>}
 * @throws on a genuine upstream failure — distinct from an honest
 *   "Apollo has nobody on file for this domain" (found: false).
 */
async function findPeopleByDomain(rawDomain, titles) {
  const apiKey = process.env.APOLLO_API_KEY;
  if (!apiKey) throw new Error('APOLLO_API_KEY is not configured.');
  const domain = cleanDomain(rawDomain);
  if (!domain) throw new Error('domain is required');

  const personTitles = (Array.isArray(titles) && titles.length) ? titles : DEFAULT_TITLES;
  const upstream = await fetch(`${APOLLO_API_BASE}/mixed_people/api_search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache', 'X-Api-Key': apiKey },
    body: JSON.stringify({ q_organization_domains_list: [domain], person_titles: personTitles, per_page: 5, page: 1 }),
    signal: AbortSignal.timeout(15000),
  });
  const data = await upstream.json().catch(() => ({}));
  if (!upstream.ok) throw new Error(data.error || data.message || `Apollo API error (${upstream.status})`);

  const people = data.people || data.contacts || [];
  return {
    found: people.length > 0,
    people: people.map(p => ({
      // A real full name only; with just an obscured last name, the first name stands alone.
      name: p.name || [p.first_name, p.last_name].filter(Boolean).join(' ') || null,
      firstName: p.first_name || (p.name ? p.name.split(/\s+/)[0] : null) || null,
      lastNameHidden: !p.name && !p.last_name && !!p.last_name_obfuscated,
      title: p.title || null,
      linkedinUrl: p.linkedin_url || null,
    })),
  };
}

module.exports = { findPeopleByDomain, cleanDomain, DEFAULT_TITLES };
