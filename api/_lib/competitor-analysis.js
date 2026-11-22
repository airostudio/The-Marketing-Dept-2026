/**
 * api/_lib/competitor-analysis.js — read one competitor's public website and
 * turn it into a battlecard in which every claim is backed by words that are
 * actually on the page.
 *
 * The model is asked for structured findings, each with a short VERBATIM quote
 * from the pages as evidence. Code then checks each quote really appears in
 * the text that was crawled; a finding whose quote is not there is dropped (and
 * counted). Prices must come with a quoted figure. Absences ("no pricing
 * shown") cannot be quoted, so they are kept apart and always labelled as
 * "not found on the pages read", with those pages listed — never as fact about
 * the competitor in general.
 *
 * The battlecard text is composed by code from the verified fields only.
 */

'use strict';

const { crawlSite } = require('./nancy-crawl.js');
const { detectTechnology } = require('./tech-detect.js');
const { callClaudeForJSON, asUntrustedContent, UNTRUSTED_CONTENT_RULE } = require('./nancy-claude.js');

const MAX_EVIDENCE = 220;
const MIN_EVIDENCE = 12;
const PLATFORM_CATEGORIES = new Set(['website-builder', 'cms', 'ecommerce']);

const item = (key) => ({ type: 'object', properties: { [key]: { type: 'string' }, evidence: { type: 'string', description: `A short VERBATIM quote (${MIN_EVIDENCE}-${MAX_EVIDENCE} characters) copied exactly from the pages, which supports this.` } }, required: [key, 'evidence'] });

const PROFILE_TOOL = {
  name: 'submit_competitor_profile',
  description: 'Submit what the competitor\'s own pages say, each finding backed by a verbatim quote.',
  input_schema: {
    type: 'object',
    properties: {
      summary: { type: 'string', description: 'Two plain sentences on what this business does, using only what the pages say.' },
      positioning: item('statement'),
      offers: { type: 'array', maxItems: 6, items: item('what') },
      pricing: { type: 'array', maxItems: 4, items: item('what'), description: 'ONLY prices or plans the pages state explicitly; the quote must contain the figure.' },
      audiences: { type: 'array', maxItems: 4, items: item('who') },
      proof_points: { type: 'array', maxItems: 4, items: item('claim'), description: 'Results, numbers or testimonials THEY claim.' },
      calls_to_action: { type: 'array', maxItems: 3, items: item('text') },
      not_found: { type: 'array', maxItems: 5, items: { type: 'string' }, description: 'Things a buyer would expect to find that are absent from the pages provided (e.g. "No pricing shown"). Phrase as absent from these pages only.' },
    },
    required: ['summary', 'positioning', 'offers'],
  },
};

const SYSTEM_PROMPT = `You are a competitive analyst reading one competitor's public website. ${UNTRUSTED_CONTENT_RULE}

Report only what the pages actually say. Every finding needs a short VERBATIM quote from the pages as evidence — copy it exactly, do not tidy or paraphrase it. Findings without a real quote are discarded.
- Pricing: only if the pages state it, and the quote must contain the figure. Never estimate a price.
- Proof points are the competitor's own claims — report them as claims, never as established fact.
- Do not infer revenue, headcount, funding, traffic or customers.
- not_found lists things absent from the pages given; it says nothing about the business beyond those pages.`;

/** Lowercase, collapse whitespace, normalise quotes and dashes so a copied quote still matches. */
function norm(s) {
  return String(s || '').toLowerCase()
    .replace(/[‘’‚‛′]/g, "'").replace(/[“”„″]/g, '"')
    .replace(/[–—]/g, '-').replace(/ /g, ' ')
    .replace(/\s+/g, ' ').trim();
}

/** Keep only findings whose evidence is really on the page. */
function verifyItems(items, key, haystack, { needsDigit = false } = {}) {
  const kept = []; let dropped = 0;
  for (const it of Array.isArray(items) ? items : []) {
    const ev = String((it && it.evidence) || '').trim().slice(0, MAX_EVIDENCE);
    const text = String((it && it[key]) || '').replace(/\s+/g, ' ').trim().slice(0, 300);
    const ok = text && ev.length >= MIN_EVIDENCE && haystack.includes(norm(ev)) && (!needsDigit || /\d/.test(ev));
    if (ok) kept.push({ [key]: text, evidence: ev }); else dropped++;
  }
  return { kept, dropped };
}

const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };

/**
 * @param {{url:string, name?:string}} competitor
 * @param {{crawl?:Function, extract?:Function, tech?:Function}} [deps] injectable for tests
 * @returns {Promise<object>} the profile, or { error } when the site could not be read
 */
async function analyzeCompetitor(competitor, deps = {}) {
  const crawl = deps.crawl || crawlSite;
  const tech = deps.tech || detectTechnology;
  const extract = deps.extract || (async (user) => {
    const r = await callClaudeForJSON({ system: SYSTEM_PROMPT, user, tool: PROFILE_TOOL, maxTokens: 3000, timeoutMs: 50000 });
    if (!r.success) throw new Error(r.error);
    return r.data;
  });

  const out = { name: competitor.name || hostOf(competitor.url), url: competitor.url, analyzed: true, error: null };
  let site;
  try { site = await crawl(competitor.url); }
  catch (e) { out.error = `Could not read the site: ${e.message}`; return out; }

  const pages = site.pages || [];
  const haystack = norm(pages.map(p => p.text).join(' \n '));
  out.pagesRead = pages.map(p => ({ title: String(p.title || '').slice(0, 120), url: p.url }));

  try {
    const t = await tech(competitor.url);
    const hit = t && t.available ? (t.technologies || []).find(x => PLATFORM_CATEGORIES.has(x.category)) : null;
    out.platform = hit ? hit.name : null;
  } catch { out.platform = null; }

  let raw;
  try {
    raw = await extract(asUntrustedContent(pages.map(p => `--- PAGE: ${p.title} (${p.url}) ---\n${p.text}`).join('\n\n'), 'competitor page content'));
  } catch (e) { out.error = `The pages were read but the analysis failed: ${e.message}`; return out; }

  let dropped = 0;
  const take = (arr, key, o) => { const r = verifyItems(arr, key, haystack, o); dropped += r.dropped; return r.kept; };
  const pos = verifyItems([raw.positioning], 'statement', haystack); dropped += pos.dropped;
  out.summary = String(raw.summary || '').replace(/\s+/g, ' ').trim().slice(0, 500);
  out.positioning = pos.kept[0] || null;
  out.offers = take(raw.offers, 'what');
  out.pricing = take(raw.pricing, 'what', { needsDigit: true });
  out.audiences = take(raw.audiences, 'who');
  out.proofPoints = take(raw.proof_points, 'claim');
  out.callsToAction = take(raw.calls_to_action, 'text');
  out.notFound = (Array.isArray(raw.not_found) ? raw.not_found : []).map(x => String(x).replace(/\s+/g, ' ').trim().slice(0, 160)).filter(Boolean).slice(0, 5);
  out.droppedUnverified = dropped;
  if (!out.positioning && !out.offers.length) out.error = 'Nothing the analysis found could be matched to the words on the pages, so no battlecard was made.';
  return out;
}

const q = (s) => `“${s}”`;

/** The battlecard text, composed from verified fields only. */
function battlecard(p, seo) {
  const L = [`## ${p.name}`, `Website: ${p.url}${p.platform ? ` · built on ${p.platform}` : ''}`, ''];
  if (p.error) { L.push(`_Could not be analysed: ${p.error}_`, ''); return L.join('\n'); }
  if (p.summary) L.push(`**Summary** (a paraphrase of their pages): ${p.summary}`, '');
  if (p.positioning) L.push(`**How they position themselves:** ${p.positioning.statement} — ${q(p.positioning.evidence)}`, '');
  const list = (title, arr, key) => { if (arr && arr.length) { L.push(`**${title}**`); arr.forEach(x => L.push(`- ${x[key]} — ${q(x.evidence)}`)); L.push(''); } };
  list('What they offer', p.offers, 'what');
  list('Pricing they state', p.pricing, 'what');
  list('Who they speak to', p.audiences, 'who');
  list('Claims they make (their own claims, not verified by us)', p.proofPoints, 'claim');
  list('Calls to action', p.callsToAction, 'text');
  if (seo && seo.available !== false && (seo.rank != null || seo.backlinks != null || (seo.keywords && seo.keywords.length))) {
    L.push('**Search data (DataForSEO)**');
    if (seo.rank != null) L.push(`- Domain rank: ${seo.rank}`);
    if (seo.backlinks != null) L.push(`- Backlinks: ${seo.backlinks}`);
    if (seo.refDomains != null) L.push(`- Referring domains: ${seo.refDomains}`);
    (seo.keywords || []).slice(0, 5).forEach(k => L.push(`- Ranks for "${k.keyword}"${k.position != null ? ` at #${k.position}` : ''}${k.searchVol != null ? ` (${k.searchVol} searches/mo)` : ''}`));
    L.push('');
  }
  if (p.notFound && p.notFound.length) {
    L.push(`**Not found on the ${(p.pagesRead || []).length} page${(p.pagesRead || []).length === 1 ? '' : 's'} read** (${(p.pagesRead || []).map(x => x.title || x.url).join('; ')}) — this does not mean they don't have it elsewhere:`);
    p.notFound.forEach(x => L.push(`- ${x}`));
    L.push('');
  }
  return L.join('\n');
}

module.exports = { analyzeCompetitor, battlecard, verifyItems, norm, hostOf, PROFILE_TOOL, SYSTEM_PROMPT };
