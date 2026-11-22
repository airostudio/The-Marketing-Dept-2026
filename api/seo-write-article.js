/**
 * api/seo-write-article.js — SEO Pipeline Stage 4: Article Writer
 *
 * POST { topic: {...one topic from seo-keyword-research...}, profile, brandVoice? }
 * Returns: { success, article: { title, meta_description, slug, body_markdown,
 *   schema_markup, word_count } }
 *
 * One article per call — even a single ~650-1000 word SEO article plus
 * metadata/FAQs/links is enough output that it was timing out against
 * Vercel's 60s function ceiling at the original 900-1600 word target;
 * trimmed the requested length/FAQ count down (see ARTICLE_TOOL below)
 * rather than just raising the timeout, since Vercel's ceiling is the
 * platform's, not something raising timeoutMs alone can get past.
 */

'use strict';

const { requireUser } = require('./_lib/require-user.js');
const { withFailureReporting } = require('./_lib/report-failure.js');
const { rateLimited } = require('./_lib/rate-limit.js');
// The prompt and tool live in the shared engine, which SEO Autopilot also uses.
const { writeArticle } = require('./_lib/seo-engine.js');

module.exports = withFailureReporting('api/seo-write-article', async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Every path below reaches a paid third party or this server's own crawler
  // on the account's credentials. Identify the caller before spending any of
  // it; a rate limit caps the speed, not the entitlement.
  const auth = await requireUser(req, res);
  if (!auth) return;

  if (rateLimited(req, res, { name: 'seo-write-article', max: 8, windowMs: 60 * 1000, auth })) return;

  const { topic, profile, brandVoice, language = '' } = req.body || {};
  if (!topic || !topic.topic) return res.status(400).json({ error: 'topic (from seo-keyword-research) is required' });
  if (!profile) return res.status(400).json({ error: 'profile (from seo-analyze-site) is required' });

  try {
    const article = await writeArticle({ topic, profile, brandVoice, language });
    return res.json({ success: true, article });
  } catch (err) {
    return res.status(502).json({ success: false, error: err.message });
  }
});
