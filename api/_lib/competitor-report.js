/**
 * api/_lib/competitor-report.js — the cross-competitor read: where the market
 * sits, where the business can stand out, what to do. Written ONLY from the
 * verified battlecard findings (api/_lib/competitor-analysis.js), the optional
 * search data, and the business's own description of itself.
 *
 * The same guard as the analytics report: every figure in the written text is
 * checked against the findings (api/_lib/analytics-facts.js verifyNumbers). An
 * invented statistic or an outside benchmark gets one rewrite; if any remain
 * the report is returned as not approved and cannot be approved.
 */

'use strict';

const { callClaudeForJSON } = require('./nancy-claude.js');
const { verifyNumbers } = require('./analytics-facts.js');
const { battlecard } = require('./competitor-analysis.js');
const { directive: languageDirective } = require('./writing-language.js');

const TOOL = {
  name: 'submit_competitive_read',
  description: 'Submit the cross-competitor read.',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Plain title, under 90 characters.' },
      summary: { type: 'string', description: '3-4 sentences on how these competitors position themselves, using only the findings.' },
      landscape: { type: 'string', description: 'Markdown: patterns across the competitors — what most of them say, what they have in common, who differs. Name the competitor each point comes from.' },
      opportunities: { type: 'array', minItems: 1, maxItems: 5, items: { type: 'string', description: 'Where THIS business could differentiate, tied to a specific finding and to what the business says about itself.' } },
      actions: { type: 'array', minItems: 1, maxItems: 5, items: { type: 'string', description: 'A concrete next step.' } },
    },
    required: ['title', 'summary', 'landscape', 'opportunities', 'actions'],
  },
};

const SYSTEM_PROMPT = `You write a competitive read for a small business owner from FINDINGS taken from their competitors' own public websites, plus a description of the business itself.

Hard rules — each exists because breaking it puts a false claim in front of someone making decisions:
- Use ONLY what is in FINDINGS. Competitors' claims are THEIR claims ("says it", "claims") — never state them as fact.
- Never state a figure that is not in FINDINGS. Never calculate one. No market sizes, shares, benchmarks or "typical" prices — there is no source for them here.
- "Not found on the pages read" means absent from those pages only. Do not say a competitor "doesn't offer" something because it wasn't found.
- A competitor marked as not analysed has no findings; say nothing about it beyond that.
- Opportunities must be tied to a specific finding AND to the business's own description. Do not invent strengths for the business.
- Do not guess revenue, customer counts, traffic or motives.`;

function compose(r, profiles, seoByUrl) {
  const L = [`# ${r.title}`, '', r.summary, '', '## Where the market sits', '', r.landscape, '', '## Where you can stand out', '', ...r.opportunities.map(x => `- ${x}`), '', '## Suggested actions', '', ...r.actions.map(x => `- ${x}`), '', '---', '', '# Competitor battlecards', ''];
  profiles.forEach(p => L.push(battlecard(p, seoByUrl[p.url])));
  return L.join('\n');
}

function findingsFor(profiles, seoByUrl) {
  return profiles.map(p => p.error
    ? { name: p.name, url: p.url, analysed: false }
    : { name: p.name, url: p.url, analysed: true, platform: p.platform, summary: p.summary, positioning: p.positioning, offers: p.offers, pricing: p.pricing, audiences: p.audiences, theirClaims: p.proofPoints, callsToAction: p.callsToAction, notFoundOnPagesRead: p.notFound, searchData: seoByUrl[p.url] || null });
}

async function writeOnce(findings, { businessContext, language, fixList, previous }) {
  const user = [
    `FINDINGS (JSON):\n${JSON.stringify(findings, null, 2)}`,
    businessContext ? `\nTHE BUSINESS ITSELF (its own description — use for the opportunities, take no figures from it):\n${String(businessContext).slice(0, 2500)}` : '\nNo description of the business was provided: keep the opportunities general and say that more about the business is needed.',
    fixList && fixList.length ? `\nYOUR PREVIOUS DRAFT contained figures that are NOT in FINDINGS: ${fixList.join(', ')}. Rewrite so every figure comes from FINDINGS — remove or replace them; do not substitute other invented ones.\nPrevious draft:\n${previous}` : '',
  ].filter(Boolean).join('\n');
  const r = await callClaudeForJSON({ system: SYSTEM_PROMPT + (languageDirective(language) ? '\n\n' + languageDirective(language) : ''), user, tool: TOOL, maxTokens: 3000, timeoutMs: 55000 });
  if (!r.success) throw new Error(r.error);
  return r.data;
}

/**
 * @param {object[]} profiles  from analyzeCompetitor (some may carry .error)
 * @param {Object<string,object>} seoByUrl
 */
async function buildCompetitorReport(profiles, seoByUrl, opts = {}, deps = {}) {
  const write = deps.write || writeOnce;
  const findings = findingsFor(profiles, seoByUrl);
  let data = await write(findings, opts);
  const text = (d) => [d.title, d.summary, d.landscape, ...(d.opportunities || []), ...(d.actions || [])].join('\n');
  let unsupported = verifyNumbers(text(data), findings);
  let fixed = false;
  if (unsupported.length) {
    try {
      data = await write(findings, { ...opts, fixList: unsupported, previous: text(data) });
      unsupported = verifyNumbers(text(data), findings);
      fixed = true;
    } catch { /* first draft and its unsupported figures stand, and block approval */ }
  }
  return {
    title: String(data.title || 'Competitive report').slice(0, 120),
    markdown: compose(data, profiles, seoByUrl),
    findings,
    review: { approved: unsupported.length === 0, unsupportedNumbers: unsupported, fixed },
  };
}

module.exports = { buildCompetitorReport, findingsFor, compose, TOOL, SYSTEM_PROMPT };
