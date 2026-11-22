/**
 * api/_lib/seo-engine.js — the SEO pipeline's three model steps as plain
 * functions: read a business's website into a profile, propose article
 * topics, and write one article. The SEO Content Engine's endpoints
 * (api/seo-analyze-site.js, seo-keyword-research.js, seo-write-article.js)
 * and SEO Autopilot's background jobs (api/_lib/autopilot/seo.js) both call
 * these, so the browser-driven pipeline and the autonomous one write the
 * same way.
 *
 * Each function makes exactly one slow call, so each fits in one serverless
 * request (see the notes in the endpoints about Vercel's time ceiling).
 */

'use strict';

const { crawlSite } = require('./nancy-crawl.js');
const { callClaudeForJSON, asUntrustedContent, UNTRUSTED_CONTENT_RULE } = require('./nancy-claude.js');
const { directive: languageDirective } = require('./writing-language.js');

const PROFILE_TOOL = {
  name: 'submit_seo_site_profile',
  description: 'Submit the structured SEO-relevant profile extracted from the crawled website content.',
  input_schema: {
    type: 'object',
    properties: {
      business_summary: { type: 'string', description: '2-3 sentence plain-English summary of what this business does' },
      products_services: { type: 'array', items: { type: 'string' }, maxItems: 8, description: 'Real products/services actually found on the site' },
      primary_offer: { type: 'string' },
      target_customer: { type: 'string' },
      industry: { type: 'string' },
      existing_topics: { type: 'array', items: { type: 'string' }, maxItems: 15, description: 'Topics/subjects the site already has content on (from blog posts, resource pages, FAQs actually found) — so a new content plan avoids duplicating these' },
      tone_notes: { type: 'string', description: 'Brief note on how the site currently writes (formal/casual/technical) so new articles match' },
    },
    required: ['business_summary', 'products_services', 'target_customer', 'industry', 'existing_topics'],
  },
};

const TOPICS_TOOL = {
  name: 'submit_seo_topics',
  description: 'Submit candidate SEO content topics grounded in the real business profile and real competitor content gaps provided.',
  input_schema: {
    type: 'object',
    properties: {
      topics: {
        type: 'array',
        minItems: 8,
        // 12, not 20: output length is what decides whether this finishes
        // inside the function's time ceiling.
        maxItems: 12,
        items: {
          type: 'object',
          properties: {
            topic: { type: 'string', description: 'The article topic, human-readable' },
            target_keyword: { type: 'string', description: 'The primary search phrase this topic targets' },
            est_search_volume: { type: 'string', description: 'Rough monthly-search-volume bucket: "low (under 100)", "medium (100-1000)", "high (1000+)" — a directional estimate, not a real number' },
            est_difficulty: { type: 'string', enum: ['low', 'medium', 'high'], description: 'Estimated how hard this would be to rank for, given typical competition for this kind of term' },
            rationale: { type: 'string', description: 'Why this topic, in one short sentence (~15 words) — grounded in a specific product/service, a real competitor content gap, or a real ICP pain point' },
            content_pillar: { type: 'string', description: 'Short category label to group related topics, e.g. "Getting Started", "Comparisons", "Use Cases"' },
          },
          required: ['topic', 'target_keyword', 'est_search_volume', 'est_difficulty', 'rationale', 'content_pillar'],
        },
      },
    },
    required: ['topics'],
  },
};

const ARTICLE_TOOL = {
  name: 'submit_seo_article',
  description: 'Submit the finished SEO article with metadata, ready to publish.',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'SEO title tag, under 60 characters, includes the target keyword naturally' },
      meta_description: { type: 'string', description: 'Meta description, 140-160 characters, includes the target keyword, written to earn the click' },
      slug: { type: 'string', description: 'URL slug: lowercase, hyphenated, short' },
      body_markdown: { type: 'string', description: 'The full article in Markdown: an H1, then H2/H3 structure, 650-1000 words, genuinely useful content (not keyword-stuffed filler), includes the target keyword naturally in the first 100 words and at least one H2. Keep each section tight — a shorter genuinely useful article beats a padded long one.' },
      faqs: {
        type: 'array', maxItems: 3,
        items: { type: 'object', properties: { question: { type: 'string' }, answer: { type: 'string', description: '1-2 sentences' } }, required: ['question', 'answer'] },
        description: 'Optional FAQ section content, real questions a searcher would actually have — keep answers short',
      },
      internal_link_suggestions: { type: 'array', items: { type: 'string' }, maxItems: 3, description: 'Suggested anchor text + what existing page on the site it should link to (based on products_services/existing_topics given) — the user fills in the real URL. One short phrase each.' },
    },
    required: ['title', 'meta_description', 'slug', 'body_markdown'],
  },
};

function buildSchemaMarkup(article) {
  const schema = { '@context': 'https://schema.org', '@type': 'Article', headline: article.title, description: article.meta_description };
  if (article.faqs && article.faqs.length) {
    return [schema, {
      '@context': 'https://schema.org', '@type': 'FAQPage',
      mainEntity: article.faqs.map(f => ({ '@type': 'Question', name: f.question, acceptedAnswer: { '@type': 'Answer', text: f.answer } })),
    }];
  }
  return [schema];
}

/** A model or crawl failure, carrying a kind the job runner can act on. */
function stepError(message, kind) { const e = new Error(message); e.kind = kind; return e; }

/**
 * Crawl a site and extract its SEO profile.
 * @returns {Promise<{profile, pagesFetched}>}
 * @throws Error with .kind 'site_unreachable' or 'model'
 */
async function analyzeSite(url, deps = {}) {
  let crawl;
  try { crawl = await (deps.crawl || crawlSite)(url); }
  catch (err) { throw stepError(err.message, 'site_unreachable'); }

  const pagesText = asUntrustedContent(
    crawl.pages.map(p => `--- PAGE: ${p.title} (${p.url}) ---\n${p.text}`).join('\n\n'),
    'crawled page content'
  );
  const system = `You are an SEO strategist extracting structured facts from real website content. Base every field ONLY on what is actually present in the provided page text — never invent a product, service, or topic that isn't genuinely there. existing_topics must be real subjects the site actually has content on (blog post titles, FAQ questions, resource pages) — if the site has no blog/resources, return an empty array rather than guessing.

${UNTRUSTED_CONTENT_RULE}`;
  const user = `Website: ${crawl.origin}\n\nCrawled page content:\n\n${pagesText}\n\nExtract the SEO-relevant business profile.`;
  const result = await (deps.claude || callClaudeForJSON)({ system, user, tool: PROFILE_TOOL, maxTokens: 3000, timeoutMs: 40000 });
  if (!result.success) throw stepError(result.error, 'model');
  return { profile: result.data, pagesFetched: crawl.pages.map(p => ({ url: p.url, title: p.title })) };
}

/**
 * Propose 8-12 article topics.
 * @returns {Promise<Array<{topic, target_keyword, est_search_volume, est_difficulty, rationale, content_pillar, data_source}>>}
 */
async function proposeTopics({ profile, competitors = [], cross_competitor_gaps = [], language = '', avoid = [] }, deps = {}) {
  const system = `You are an SEO content strategist proposing article topics. Ground every topic in the REAL business profile, products/services, and competitor content gaps provided — never propose a topic unrelated to what this business actually offers. Avoid duplicating any topic already in existing_topics. Search volume and difficulty are directional buckets, not real numbers — you have no live keyword database.${languageDirective(language) ? ' ' + languageDirective(language) : ''}`;
  const user = `BUSINESS PROFILE:\n${JSON.stringify(profile, null, 2)}\n\nCOMPETITOR CONTENT (${competitors.length} competitors researched):\n${JSON.stringify(competitors, null, 2)}\n\nCROSS-COMPETITOR CONTENT GAPS:\n${JSON.stringify(cross_competitor_gaps, null, 2)}${avoid.length ? `\n\nALREADY WRITTEN OR PLANNED (do not repeat these):\n${JSON.stringify(avoid.slice(0, 60))}` : ''}\n\nPropose 8-12 SEO article topics that would genuinely help this specific business, prioritizing real content gaps and real product/service coverage over generic industry topics.`;
  const result = await (deps.claude || callClaudeForJSON)({ system, user, tool: TOPICS_TOOL, maxTokens: 3000, timeoutMs: 55000 });
  if (!result.success) throw stepError(result.error, 'model');
  return (result.data.topics || []).map(t => ({
    topic: t.topic, target_keyword: t.target_keyword,
    search_volume: null, difficulty: null,
    est_search_volume: t.est_search_volume, est_difficulty: t.est_difficulty,
    data_source: 'estimate', rationale: t.rationale, content_pillar: t.content_pillar,
  }));
}

/**
 * Write one article.
 * @param {object} o
 * @param {Array<{title, url}>} [o.siteLinks]  the site's real pages/posts. When given,
 *   the article may link to these URLs (and only these) — the caller checks it.
 */
async function writeArticle({ topic, profile, brandVoice = '', language = '', siteLinks = [] }, deps = {}) {
  const links = (siteLinks || []).filter(l => l && l.url && l.title).slice(0, 25);
  const system = `You are an expert SEO content writer. Write a genuinely useful, well-researched article that happens to be well-optimized for search — never keyword-stuffed filler. Ground every factual claim about the business in the profile given; never invent a specific product feature, price, or statistic that isn't provided. If you'd naturally cite a stat you don't have, phrase it generally instead of inventing a number. Spelling and grammar must be flawless.${links.length ? ' Where it genuinely helps the reader, link 2-3 times to the site\'s own pages listed under SITE PAGES, using Markdown links with those exact URLs — never invent or alter a URL, and never link anywhere else.' : ''}${languageDirective(language) ? ' ' + languageDirective(language) : ''}`;
  const user = `TOPIC: ${topic.topic}
TARGET KEYWORD: ${topic.target_keyword}
WHY THIS TOPIC: ${topic.rationale || ''}
CONTENT PILLAR: ${topic.content_pillar || ''}

BUSINESS PROFILE (ground the article in this — real products/services, real target customer, do not invent beyond this):
${JSON.stringify(profile, null, 2)}
${brandVoice ? `\nBRAND VOICE: ${brandVoice}` : ''}${links.length ? `\n\nSITE PAGES (the only URLs you may link to):\n${links.map(l => `- ${l.title}: ${l.url}`).join('\n')}` : ''}

Write the complete article now.`;
  const result = await (deps.claude || callClaudeForJSON)({ system, user, tool: ARTICLE_TOOL, maxTokens: 4500, timeoutMs: 55000 });
  if (!result.success) throw stepError(result.error, 'model');
  const data = result.data;
  return {
    title: data.title,
    meta_description: data.meta_description,
    slug: data.slug,
    body_markdown: data.body_markdown,
    faqs: data.faqs || [],
    internal_link_suggestions: data.internal_link_suggestions || [],
    schema_markup: buildSchemaMarkup(data),
    word_count: (data.body_markdown || '').trim().split(/\s+/).filter(Boolean).length,
    target_keyword: topic.target_keyword,
  };
}

module.exports = { analyzeSite, proposeTopics, writeArticle, buildSchemaMarkup, PROFILE_TOOL, TOPICS_TOOL, ARTICLE_TOOL };
