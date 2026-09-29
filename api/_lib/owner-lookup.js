/**
 * api/_lib/owner-lookup.js — grounded, never-fabricating owner/manager
 * first-name lookup (Perplexity Sonar), split out of api/blade-find-owner.js
 * so api/cron-sales-intel-sweep.js can call it directly for a business it
 * just discovered itself, without an internal HTTP round-trip.
 *
 * See api/blade-find-owner.js for the full reasoning — this is a verbatim
 * extraction, not a rewrite. A wrong name in a cold email's greeting is
 * worse than no name at all, so an unconfident or non-name-shaped answer is
 * always returned as '', never guessed at.
 */

'use strict';

const PERPLEXITY_URL = 'https://api.perplexity.ai/chat/completions';

/**
 * @returns {Promise<{firstName: string, source: string}>}
 * @throws on a genuine upstream/parse failure — distinct from an honest
 *   "searched and found nobody", which resolves with firstName: ''.
 */
async function findOwnerName({ businessName, suburb, country, website }) {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) throw new Error('PERPLEXITY_API_KEY is not configured.');
  if (!businessName || !String(businessName).trim()) throw new Error('businessName is required');

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
