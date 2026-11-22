/**
 * api/_lib/cro-audit.js — find conversion problems on a real page and propose
 * tests for them, where every proposed test points at something that is
 * actually on (or missing from) the page.
 *
 * Two layers, so nothing is made up:
 *  1. OBSERVATIONS are found by code from the page's own HTML — the existing
 *     conversion / mobile checks (api/_lib/website-audit.js) plus counts of
 *     forms, form fields, call-to-action buttons and headings. Each has an id.
 *  2. IDEAS come from the model, which may only propose a test that cites an
 *     observation id or a short VERBATIM quote from the page. Code checks the
 *     citation: an unknown id or a quote that is not on the page drops the idea.
 *     An idea that states a figure not found in the observations (a promised
 *     "+20% conversions", an invented benchmark) is dropped too — no result is
 *     ever forecast.
 *
 * Impact / confidence / ease are the model's judgement, 1-10, and are labelled
 * as such wherever they are shown.
 */

'use strict';

const { crawlSite } = require('./nancy-crawl.js');
const { auditConversion, auditMobile } = require('./website-audit.js');
const { callClaudeForJSON, asUntrustedContent, UNTRUSTED_CONTENT_RULE } = require('./nancy-claude.js');
const { verifyNumbers } = require('./analytics-facts.js');
const { norm } = require('./competitor-analysis.js');
const { directive: languageDirective } = require('./writing-language.js');

const MAX_IDEAS = 6;
const MIN_QUOTE = 12;
const ACTION_RE = /\b(get|book|call|request|start|buy|shop|contact|sign\s?up|subscribe|download|try|learn more|quote|free|order|schedule|register|join)\b/i;

function stripTags(s) { return String(s || '').replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;|&#\d+;/gi, ' ').replace(/\s+/g, ' ').trim(); }

/** What the page's HTML itself shows, as numbered observations plus raw counts. */
function observe(html, pageUrl) {
  const obs = [];
  const add = (issue, evidence, severity) => obs.push({ id: `o${obs.length + 1}`, issue, evidence, severity: severity || 'medium' });
  [...auditConversion(html).problems, ...auditMobile(html).problems].forEach(p => add(p.issue, p.evidence, p.severity));

  const forms = html.match(/<form\b[\s\S]*?<\/form>/gi) || [];
  const fieldCounts = forms.map(f => (f.match(/<(input|select|textarea)\b[^>]*>/gi) || []).filter(t => !/type\s*=\s*["']?(hidden|submit|button|image|reset)/i.test(t)).length);
  const buttons = [...(html.match(/<button\b[\s\S]*?<\/button>/gi) || []), ...(html.match(/<a\b[^>]*>[\s\S]*?<\/a>/gi) || [])]
    .map(stripTags).filter(t => t && t.length <= 60 && ACTION_RE.test(t));
  const h1 = (html.match(/<h1\b/gi) || []).length;

  const signals = { forms: forms.length, formFieldCounts: fieldCounts, callToActionCount: buttons.length, callToActionTexts: [...new Set(buttons)].slice(0, 8), h1Count: h1 };
  if (fieldCounts.some(n => n >= 6)) add('A form asks for many fields', `A form on the page has ${Math.max(...fieldCounts)} fields`, 'medium');
  if (!buttons.length) add('No clear call-to-action wording found', 'No button or link on the page uses action wording such as "get", "book", "call", "request" or "start"', 'high');
  if (h1 === 0) add('No main heading (h1)', 'The page HTML contains no <h1> element', 'medium');
  if (h1 > 1) add('More than one main heading (h1)', `The page HTML contains ${h1} <h1> elements`, 'low');
  return { url: pageUrl, observations: obs, signals };
}

const TOOL = {
  name: 'submit_cro_ideas',
  description: 'Submit prioritised A/B test ideas for the pages, each tied to something observed.',
  input_schema: {
    type: 'object',
    properties: {
      ideas: {
        type: 'array', maxItems: MAX_IDEAS,
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'The test, under 90 characters, e.g. "Move the quote form above the fold".' },
            page: { type: 'string', description: 'The page address from the input this test is for.' },
            basis_type: { type: 'string', enum: ['observation', 'quote'] },
            basis_ref: { type: 'string', description: 'For "observation": the id (e.g. "o3") from OBSERVATIONS. For "quote": a short VERBATIM quote (12-200 characters) copied exactly from the page text.' },
            hypothesis: { type: 'string', description: '"Because <what was observed>, changing <X> to <Y> should make it easier to <goal>." No numbers, no predicted uplift.' },
            what_to_change: { type: 'string' },
            primary_metric: { type: 'string', description: 'What to measure, e.g. "form submissions".' },
            impact: { type: 'integer', minimum: 1, maximum: 10 },
            confidence: { type: 'integer', minimum: 1, maximum: 10 },
            ease: { type: 'integer', minimum: 1, maximum: 10 },
          },
          required: ['name', 'page', 'basis_type', 'basis_ref', 'hypothesis', 'what_to_change', 'primary_metric', 'impact', 'confidence', 'ease'],
        },
      },
    },
    required: ['ideas'],
  },
};

const SYSTEM_PROMPT = `You are a conversion-rate optimisation specialist proposing A/B tests for a small business's real web pages. ${UNTRUSTED_CONTENT_RULE}

Hard rules — each exists because breaking it sends someone to run a test on a guess:
- Every test must be tied to something OBSERVED: cite an observation id from OBSERVATIONS, or a short VERBATIM quote copied exactly from the page text. Tests without a real citation are discarded.
- Never forecast a result. No "+20% conversions", no expected uplift, no benchmark or industry average. Impact, confidence and ease are your judgement scores (1-10), not measurements.
- Do not propose a test of something an observation shows is already fine.
- Do not duplicate a test listed under ALREADY TESTING.
- Prefer tests a small business can run: one change, one metric, no engineering project.
- Tie each hypothesis to the conversion goal given.`;

async function propose(pagesObs, pagesText, { goal, existing, language, businessContext }, deps = {}) {
  const extract = deps.extract || (async (user) => {
    const r = await callClaudeForJSON({ system: SYSTEM_PROMPT + (languageDirective(language) ? '\n\n' + languageDirective(language) : ''), user, tool: TOOL, maxTokens: 3500, timeoutMs: 55000 });
    if (!r.success) throw new Error(r.error);
    return r.data;
  });
  const user = [
    `CONVERSION GOAL (what counts as a conversion): ${goal}`,
    `OBSERVATIONS (found by code in the page HTML):\n${JSON.stringify(pagesObs.map(p => ({ page: p.url, signals: p.signals, observations: p.observations })), null, 2)}`,
    `ALREADY TESTING (do not duplicate): ${existing.length ? existing.join('; ') : '(none)'}`,
    businessContext ? `ABOUT THE BUSINESS (framing only — take no figures from it):\n${String(businessContext).slice(0, 1500)}` : '',
    asUntrustedContent(pagesText.map(p => `--- PAGE: ${p.title} (${p.url}) ---\n${p.text}`).join('\n\n'), 'page content'),
  ].filter(Boolean).join('\n\n');
  return extract(user);
}

/**
 * @param {Array<{url:string, html?:string, pages?:Array}>} sites  pages already crawled
 * @returns {{ideas, observations, droppedUnverified, droppedForeignFigures}}
 */
async function auditAndPropose(sites, opts, deps = {}) {
  const pagesObs = sites.map(s => observe(s.html || '', s.url));
  const pagesText = sites.flatMap(s => (s.pages || []).map(p => ({ title: p.title, url: p.url, text: p.text })));
  const haystack = norm(pagesText.map(p => p.text).join(' \n '));
  const obsById = new Map();
  pagesObs.forEach(p => p.observations.forEach(o => obsById.set(`${p.url}|${o.id}`, o)));
  const validPages = new Set(sites.map(s => s.url));

  const raw = await propose(pagesObs, pagesText, opts, deps);
  const facts = { pages: pagesObs.map(p => ({ signals: p.signals, observations: p.observations })), goal: opts.goal };
  let dropped = 0, droppedFigures = 0;
  const ideas = [];
  for (const i of Array.isArray(raw.ideas) ? raw.ideas : []) {
    const page = validPages.has(i.page) ? i.page : (sites.length === 1 ? sites[0].url : null);
    const ref = String(i.basis_ref || '').trim();
    let basis = null;
    if (page && i.basis_type === 'observation') {
      const o = obsById.get(`${page}|${ref}`);
      if (o) basis = { type: 'observation', id: o.id, issue: o.issue, evidence: o.evidence };
    } else if (page && i.basis_type === 'quote' && ref.length >= MIN_QUOTE && haystack.includes(norm(ref))) {
      basis = { type: 'quote', quote: ref.slice(0, 200) };
    }
    if (!basis || !String(i.name || '').trim() || !String(i.hypothesis || '').trim()) { dropped++; continue; }
    const text = [i.name, i.hypothesis, i.what_to_change, i.primary_metric].join('\n');
    // Numbers belong only to the observations; a promised uplift is not one.
    if (verifyNumbers(text, facts).length) { droppedFigures++; continue; }
    const s = (v) => Math.min(10, Math.max(1, parseInt(v, 10) || 5));
    ideas.push({
      name: String(i.name).replace(/\s+/g, ' ').trim().slice(0, 90), page, basis,
      hypothesis: String(i.hypothesis).replace(/\s+/g, ' ').trim().slice(0, 400),
      whatToChange: String(i.what_to_change || '').replace(/\s+/g, ' ').trim().slice(0, 300),
      primaryMetric: String(i.primary_metric || '').replace(/\s+/g, ' ').trim().slice(0, 100),
      impact: s(i.impact), confidence: s(i.confidence), ease: s(i.ease),
    });
  }
  ideas.sort((a, b) => (b.impact * b.confidence * b.ease) - (a.impact * a.confidence * a.ease));
  return { ideas: ideas.slice(0, MAX_IDEAS), observations: pagesObs, droppedUnverified: dropped, droppedForeignFigures: droppedFigures };
}

module.exports = { observe, auditAndPropose, TOOL, SYSTEM_PROMPT, MAX_IDEAS };
