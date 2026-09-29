/**
 * api/blade-find-owner.js — Blade: find a real person's first name to
 * address a shortlisted lead by, for the mail-merge audit workflow
 * ("find 100-150 plumbers, audit them, shortlist the best 50, find the
 * owner's name, generate a personalised observation, export a CSV").
 *
 * This is a real, cited web search (Perplexity Sonar), not a guess: the
 * prompt requires a source for the name and explicitly forbids inventing
 * one when nothing turns up — a wrong name in a cold email ("Hi Mark," to
 * someone who isn't Mark) is worse than no name at all, and this app's
 * whole session has been about never fabricating data the product then
 * asserts as fact.
 *
 * POST { businessName, suburb, country, website? }
 * Returns: { success, firstName: string, source: string|null }
 *   firstName is '' when nothing was confidently found — never a guess.
 */

'use strict';

const { requireUser } = require('./_lib/require-user.js');
const { withFailureReporting } = require('./_lib/report-failure.js');
const { rateLimited } = require('./_lib/rate-limit.js');

const PERPLEXITY_URL = 'https://api.perplexity.ai/chat/completions';
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 20;

module.exports = withFailureReporting('api/blade-find-owner', async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = await requireUser(req, res);
  if (!auth) return;

  if (rateLimited(req, res, { name: 'blade-find-owner', max: RATE_LIMIT_MAX, windowMs: RATE_LIMIT_WINDOW_MS, auth })) return;

  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'PERPLEXITY_API_KEY is not configured.' });

  const { businessName, suburb, country, website } = req.body || {};
  if (!businessName || !String(businessName).trim()) return res.status(400).json({ error: 'businessName is required' });

  const where = [suburb, country].filter(Boolean).join(', ');
  const prompt = `Find the real first name of the owner, founder, or manager of this small local business: "${businessName}"${where ? ` in ${where}` : ''}${website ? ` (website: ${website})` : ''}.

Look at their website's About/Team page, Google Business Profile, Facebook page, and any local directory or news listing.

Respond with ONLY this JSON object, no markdown, no explanation:
{ "firstName": "their first name, or empty string if you cannot confidently identify a real person", "source": "the URL where you found this, or empty string" }

Rules:
- Only return a name you found stated as a real fact on a real page — never guess, infer from the business name, or invent a plausible-sounding name.
- A business name containing a person's name (e.g. "Steve's Plumbing") is NOT enough by itself — only use it if you also find that name confirmed as the actual owner/manager elsewhere.
- If you are not confident, return an empty string for both fields. An honest "not found" is far better than a wrong name in an email to this person.`;

  try {
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
    // Shape check only — a "name" that's actually a sentence means the model
    // ignored the instruction, and passing that through would put a garbled
    // fragment into a real email's greeting.
    const looksLikeAName = /^[A-Za-z][A-Za-z'-]{0,30}$/.test(firstName);

    return res.json({
      success: true,
      firstName: looksLikeAName ? firstName : '',
      source: looksLikeAName ? (parsed.source || '') : '',
    });
  } catch (e) {
    // Distinct from "searched and confirmed nobody could be identified" —
    // that's a real, honest result (firstName: ''); this is our own lookup
    // failing, which the caller should retry rather than treat as a verdict.
    return res.status(502).json({ error: e.message });
  }
});
