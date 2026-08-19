/**
 * api/seo-write-article.js — SEO Pipeline Stage 4: Article Writer
 *
 * POST { topic: {...one topic from seo-keyword-research...}, profile, brandVoice? }
 * Returns: { success, article: { title, meta_description, slug, body_markdown,
 *   schema_markup, word_count } }
 *
 * One article per call — a full 1000-1800 word SEO article plus metadata is
 * a lot of output tokens; batching multiple articles into one call is
 * exactly the shape that caused truncation in Nancy's content planner
 * before it was split to one-post-per-call. Same fix applied here from the
 * start rather than rediscovering it.
 */

'use strict';

const { callClaudeForJSON } = require('./_lib/nancy-claude.js');

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 8;
const rateBuckets = new Map();

function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) return fwd.split(',')[0].trim();
  return req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
}
function checkRateLimit(ip) {
  const now = Date.now();
  let b = rateBuckets.get(ip);
  if (!b || now - b.windowStart > RATE_LIMIT_WINDOW_MS) { b = { windowStart: now, count: 0 }; rateBuckets.set(ip, b); }
  b.count++;
  return b.count <= RATE_LIMIT_MAX;
}

const ARTICLE_TOOL = {
  name: 'submit_seo_article',
  description: 'Submit the finished SEO article with metadata, ready to publish.',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'SEO title tag, under 60 characters, includes the target keyword naturally' },
      meta_description: { type: 'string', description: 'Meta description, 140-160 characters, includes the target keyword, written to earn the click' },
      slug: { type: 'string', description: 'URL slug: lowercase, hyphenated, short' },
      body_markdown: { type: 'string', description: 'The full article in Markdown: an H1, then H2/H3 structure, 900-1600 words, genuinely useful content (not keyword-stuffed filler), includes the target keyword naturally in the first 100 words and at least one H2' },
      faqs: {
        type: 'array', maxItems: 5,
        items: { type: 'object', properties: { question: { type: 'string' }, answer: { type: 'string' } }, required: ['question', 'answer'] },
        description: 'Optional FAQ section content, real questions a searcher would actually have',
      },
      internal_link_suggestions: { type: 'array', items: { type: 'string' }, maxItems: 5, description: 'Suggested anchor text + what existing page on the site it should link to (based on products_services/existing_topics given) — the user fills in the real URL' },
    },
    required: ['title', 'meta_description', 'slug', 'body_markdown'],
  },
};

function buildSchemaMarkup(article, profile) {
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: article.title,
    description: article.meta_description,
  };
  if (article.faqs && article.faqs.length) {
    return [
      schema,
      {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: article.faqs.map(f => ({
          '@type': 'Question', name: f.question,
          acceptedAnswer: { '@type': 'Answer', text: f.answer },
        })),
      },
    ];
  }
  return [schema];
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = getClientIp(req);
  if (!checkRateLimit(ip)) return res.status(429).json({ error: 'Too many requests. Slow down.' });

  const { topic, profile, brandVoice } = req.body || {};
  if (!topic || !topic.topic) return res.status(400).json({ error: 'topic (from seo-keyword-research) is required' });
  if (!profile) return res.status(400).json({ error: 'profile (from seo-analyze-site) is required' });

  const system = `You are an expert SEO content writer. Write a genuinely useful, well-researched article that happens to be well-optimized for search — never keyword-stuffed filler. Ground every factual claim about the business in the profile given; never invent a specific product feature, price, or statistic that isn't provided. If you'd naturally cite a stat you don't have, phrase it generally instead of inventing a number.`;

  const user = `TOPIC: ${topic.topic}
TARGET KEYWORD: ${topic.target_keyword}
WHY THIS TOPIC: ${topic.rationale || ''}
CONTENT PILLAR: ${topic.content_pillar || ''}

BUSINESS PROFILE (ground the article in this — real products/services, real target customer, do not invent beyond this):
${JSON.stringify(profile, null, 2)}
${brandVoice ? `\nBRAND VOICE: ${brandVoice}` : ''}

Write the complete article now.`;

  const result = await callClaudeForJSON({ system, user, tool: ARTICLE_TOOL, maxTokens: 6000, timeoutMs: 55000 });
  if (!result.success) return res.status(502).json({ success: false, error: result.error });

  const data = result.data;
  const wordCount = (data.body_markdown || '').trim().split(/\s+/).filter(Boolean).length;

  return res.json({
    success: true,
    article: {
      title: data.title,
      meta_description: data.meta_description,
      slug: data.slug,
      body_markdown: data.body_markdown,
      faqs: data.faqs || [],
      internal_link_suggestions: data.internal_link_suggestions || [],
      schema_markup: buildSchemaMarkup(data, profile),
      word_count: wordCount,
      target_keyword: topic.target_keyword,
    },
  });
};
