/**
 * api/generate-social-posts.js — Organic Social Content Engine
 *
 * POST {
 *   platforms:      string[],  // ['LinkedIn','Instagram','Twitter/X','TikTok','Facebook'] — one or more
 *   contentGoal:    string,    // 'Thought Leadership'|'Product Launch'|'Case Study'|'Engagement'|'Community Building'
 *   topic:          string,    // topic/theme brief
 *   frequency:      string,    // posting cadence context, e.g. '3x per week'
 *   postCount:      number,    // total posts to generate across all platforms
 *   businessContext?: string,  // pre-assembled BusinessBrain context (ICP, brand voice, value props) from the client
 *   competitors?:   string,    // optional named competitors for differentiation angles
 * }
 *
 * Returns: {
 *   success: true,
 *   contentPlanNote: string,
 *   posts: [{ platform, title, hook, body, hashtags: string[], postingTime, engagementNote }],
 *   content: string,  // human-readable markdown rendering of the same data
 *   platforms, contentGoal, postCount, usage
 * }
 *
 * Structured output via a forced Claude tool call (submit_social_posts) — every
 * post is a real, individually-addressable object, not a fragment of one big
 * markdown blob regex'd back apart client-side.
 *
 * Uses Claude claude-sonnet-4-6. Requires ANTHROPIC_API_KEY env var.
 */

'use strict';

const { requireUser } = require('./_lib/require-user.js');
const { withFailureReporting } = require('./_lib/report-failure.js');
const { rateLimited } = require('./_lib/rate-limit.js');
const { generateSocialPosts, renderPostsAsMarkdown } = require('./_lib/social-posts-gen.js');

const RATE_LIMIT_WINDOW = 60 * 1000;
const RATE_LIMIT_MAX    = 10;

module.exports = withFailureReporting('api/generate-social-posts', async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Spends the account's own API credits, so it has to know whose they are.
  const auth = await requireUser(req, res);
  if (!auth) return;

  // After authentication: the burst limit is keyed on the account, so
  // it needs the caller to exist before it runs.
  if (rateLimited(req, res, { name: 'generate-social-posts', max: RATE_LIMIT_MAX, windowMs: RATE_LIMIT_WINDOW, auth: auth })) return;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });

  const {
    platforms       = ['LinkedIn'],
    contentGoal     = 'Engagement',
    topic,
    frequency       = '3x per week',
    postCount       = 5,
    businessContext = '',
    competitors     = '',
  } = req.body || {};

  if (!topic) return res.status(400).json({ error: 'topic is required' });
  if (!Array.isArray(platforms) || platforms.length === 0) return res.status(400).json({ error: 'platforms must be a non-empty array' });

  try {
    const out = await generateSocialPosts({ apiKey, platforms, contentGoal, topic, frequency, postCount, businessContext, competitors });
    return res.json({
      success:         true,
      contentPlanNote: out.contentPlanNote,
      posts:           out.posts,
      content:         renderPostsAsMarkdown(out.contentPlanNote, out.posts),
      platforms,
      contentGoal,
      postCount:       out.posts.length,
      usage:           out.usage,
    });
  } catch (err) {
    return res.status(err.status || 502).json({ error: err.message });
  }
});
