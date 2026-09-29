/**
 * api/_lib/owner-lookup.js — grounded, never-fabricating owner/manager
 * first-name lookup, split out of api/blade-find-owner.js so
 * api/cron-sales-intel-sweep.js can call it directly for a business it
 * just discovered itself, without an internal HTTP round-trip.
 *
 * Two real sources, tried in order — never a guess from either:
 *   1. Apollo.io (api/_lib/apollo-client.js) — a real B2B contact database.
 *      Only usable when there's a website to derive a domain from, and only
 *      returns someone Apollo already has on file at that domain under an
 *      owner/founder-type title. Preferred when it has an answer: a
 *      database record beats an LLM's web search for precision.
 *   2. Perplexity Sonar — a live, cited web search, for whenever Apollo has
 *      no domain to search (no website) or no record for it. Small local
 *      businesses are exactly the segment Apollo's B2B database tends to
 *      have the thinnest coverage of, so this fallback matters, not just a
 *      formality.
 *
 * A wrong name in a cold email's greeting is worse than no name at all, so
 * an unconfident or non-name-shaped answer from either source is always
 * returned as '', never guessed at.
 */

'use strict';

const { findPeopleByDomain } = require('./apollo-client.js');

const PERPLEXITY_URL = 'https://api.perplexity.ai/chat/completions';

async function findOwnerNameViaApollo(website) {
  if (!website || !process.env.APOLLO_API_KEY) return null;
  try {
    const { found, people } = await findPeopleByDomain(website);
    if (!found) return null;
    const withName = people.find(p => p.firstName);
    if (!withName) return null;
    return { firstName: withName.firstName, source: withName.linkedinUrl || 'Apollo.io' };
  } catch (e) {
    // Apollo being down/misconfigured just means "try Perplexity instead" —
    // not a reason to fail the whole lookup.
    console.warn('[owner-lookup] Apollo lookup failed, falling back to Perplexity:', e.message);
    return null;
  }
}

/**
 * @returns {Promise<{firstName: string, source: string}>}
 * @throws on a genuine Perplexity upstream/parse failure (only reached when
 *   Apollo found nobody) — distinct from an honest "searched and found
 *   nobody", which resolves with firstName: ''.
 */
async function findOwnerName({ businessName, suburb, country, website }) {
  if (!businessName || !String(businessName).trim()) throw new Error('businessName is required');

  const viaApollo = await findOwnerNameViaApollo(website);
  if (viaApollo) return viaApollo;

  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) return { firstName: '', source: '' };

  const where = [suburb, country].filter(Boolean).join(', ');
  const prompt = `Find the real first name of the owner, founder, or manager of this small local business: "${businessName}"${where ? ` in ${where}` : ''}${website ? ` (website: ${website})` : ''}.

Look at their website's About/Team page, Google Business Profile, Facebook page, and any local directory or news listing.

Respond with ONLY this JSON object, no markdown, no explanation:
{ "firstName": "their first name, or empty string if you cannot confidently identify a real person", "source": "the URL where you found this, or empty string" }

Rules:
- Only return a name you found stated as a real fact on a real page — never guess, infer from the business name, or invent a plausible-sounding name.
- A business name containing a person's name (e.g. "Steve's Plumbing") is NOT enough by itself — only use it if you also find that name confirmed as the actual owner/manager elsewhere.
- If you are not confident, return an empty string for both fields. An honest "not found" is far better than a wrong name in an email to this person.`;

  const pRes = await fetch(PERPLEXITY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'sonar',
      messages: [
        { role: 'system', content: 'You research small local businesses and identify real people by name, only when you find them confirmed on a real page. You never guess or invent a name. Output only valid JSON exactly as instructed.' },
        { role: 'user', content: prompt },
      ],
      max_tokens: 300,
      temperature: 0,
      stream: false,
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!pRes.ok) {
    const errText = await pRes.text().catch(() => '');
    throw new Error(`Perplexity API error ${pRes.status}: ${errText.slice(0, 200)}`);
  }

  const pData = await pRes.json();
  const rawText = pData.choices?.[0]?.message?.content || '';
  const cleaned = rawText.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/, '').trim();

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Could not parse a response as JSON.');
    parsed = JSON.parse(match[0]);
  }

  const firstName = (parsed.firstName || '').trim();
  const looksLikeAName = /^[A-Za-z][A-Za-z'-]{0,30}$/.test(firstName);

  return {
    firstName: looksLikeAName ? firstName : '',
    source: looksLikeAName ? (parsed.source || '') : '',
  };
}

module.exports = { findOwnerName };
