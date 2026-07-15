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

const RATE_LIMIT_WINDOW = 60 * 1000;
const RATE_LIMIT_MAX    = 10;
const rateBuckets       = new Map();

function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) return fwd.split(',')[0].trim();
  return req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
}

function checkRateLimit(ip) {
  const now = Date.now();
  let b = rateBuckets.get(ip);
  if (!b || now - b.windowStart > RATE_LIMIT_WINDOW) {
    b = { windowStart: now, count: 0 };
    rateBuckets.set(ip, b);
  }
  b.count++;
  return b.count <= RATE_LIMIT_MAX;
}

// ── Platform content strategy (native format + posting norms) ──────────────
const PLATFORM_STRATEGY = {
  'LinkedIn': 'Professional register. Hook line must earn the "see more" click within ~2 lines. Long-form (150-300 words) performs for thought leadership; short + punchy for engagement. Native document/carousel framing where relevant. No link-in-first-line (algorithm suppresses it) — put links in the first comment if needed.',
  'Instagram': 'Visual-first — caption supports the image/reel, doesn\'t replace it. Hook in the first line before the "more" fold. Conversational tone. Emojis as visual breaks, not decoration. Strong CTA to save/share/comment, not just like.',
  'Twitter/X': 'Conversational, opinionated, native voice. Lead with the take, not a throat-clear. Thread format for multi-point arguments (mark "Post 1/2/3" clearly). No hashtag-stuffing — 0-2 max.',
  'TikTok': 'Caption is secondary to the video/hook — write it as a companion, not a script. Short, punchy, trend-aware language. Native slang where authentic to the brand voice, never forced.',
  'Facebook': 'Community/conversation framing. Questions and relatable statements outperform pure promotion. Slightly longer copy tolerated vs Instagram. Native video/photo framing.',
};

// ── Content goal → strategic framing ────────────────────────────────────────
const GOAL_STRATEGY = {
  'Thought Leadership': 'Take a genuine point of view — agree/disagree with a common industry belief, back it with real experience or data. Avoid generic "5 tips" filler; a strong POV outperforms a listicle.',
  'Product Launch': 'Lead with the customer outcome, not the feature list. What changes for them? Use a before/after or a specific use case, not a spec sheet.',
  'Case Study': 'Name specifics — the type of customer, the specific problem, the specific result (numbers if available from business context). Vague "great results" content underperforms.',
  'Engagement': 'Ask a genuine question or take a debatable stance people want to respond to. The goal is comments/shares, not just impressions — optimize for reply-worthiness.',
  'Community Building': 'Speak to the audience as peers/insiders. Reference shared frustrations or in-jokes of the space. Behind-the-scenes or "how we think about X" framing works well.',
};

function buildSystemPrompt(platforms, contentGoal, frequency, businessContext, competitors) {
  const platformGuides = platforms
    .map(p => `**${p}**: ${PLATFORM_STRATEGY[p] || 'Write in the platform\'s native voice and format.'}`)
    .join('\n');

  let prompt = `You are a social media strategist who creates platform-native content that drives genuine engagement — not generic filler that could belong to any brand.

## PLATFORMS REQUESTED
${platformGuides}

## CONTENT GOAL: ${contentGoal}
${GOAL_STRATEGY[contentGoal] || 'Write content that serves this specific goal concretely, not generically.'}

## POSTING CADENCE CONTEXT
${frequency}
`;

  if (businessContext && businessContext.trim()) {
    prompt += `\n## BUSINESS CONTEXT (use this — real ICP, brand voice, value props, and pain points, not generic industry language)\n${businessContext.trim()}\n`;
  } else {
    prompt += `\n⚠️ No business context was provided — write the best generic-industry content you can, but flag in contentPlanNote that connecting BusinessBrain would sharpen targeting significantly.\n`;
  }

  if (competitors && competitors.trim()) {
    prompt += `\n## COMPETITIVE CONTEXT\nKnown competitors: ${competitors.trim()}. Where a differentiation angle fits naturally, use it — don't force it into every post.\n`;
  }

  prompt += `
## HARD RULES
1. Every post needs a real, specific hook — not "Are you struggling with X?" boilerplate. Reference something concrete from the topic/business context.
2. Hashtags must be genuinely relevant to the post and platform norms (LinkedIn/Instagram: 3-8; Twitter/X: 0-2; TikTok: 3-6 trend-aware tags).
3. Posting time recommendations should reflect real platform behavior patterns (e.g. LinkedIn = weekday mornings, Instagram = evenings/weekends), not a generic "9am" default for every post.
4. No two posts in the batch should share the same hook structure or opening line pattern — genuine variety, not the same template restated.
5. Call the submit_social_posts tool with the complete batch. Do not write prose output.`;

  return prompt;
}

const SOCIAL_POSTS_TOOL = {
  name: 'submit_social_posts',
  description: 'Submit the complete generated content batch as structured posts, one object per post.',
  input_schema: {
    type: 'object',
    properties: {
      contentPlanNote: {
        type: 'string',
        description: 'A 2-4 sentence overview of the content strategy for this batch and how the posts vary from each other.',
      },
      posts: {
        type: 'array',
        description: 'One object per generated post, across all requested platforms.',
        items: {
          type: 'object',
          properties: {
            platform:       { type: 'string', description: 'Exact platform name from the request, e.g. "LinkedIn"' },
            title:          { type: 'string', description: 'Short internal label for this post, e.g. "The pricing objection post"' },
            hook:           { type: 'string', description: 'The first line — must work as a scroll-stopper on its own' },
            body:           { type: 'string', description: 'Full post copy including the hook as its opening line' },
            hashtags:       { type: 'array', items: { type: 'string' }, description: 'Platform-appropriate hashtags, without the # symbol' },
            postingTime:    { type: 'string', description: 'Recommended day/time to post, with a one-clause reason' },
            engagementNote: { type: 'string', description: 'Why this specific post should perform well for this goal/platform' },
          },
          required: ['platform', 'title', 'hook', 'body', 'hashtags', 'postingTime', 'engagementNote'],
        },
      },
    },
    required: ['contentPlanNote', 'posts'],
  },
};

function renderPostsAsMarkdown(planNote, posts) {
  let out = `**Content Plan:** ${planNote}\n\n`;
  posts.forEach((p, i) => {
    out += `---\n## Post ${i + 1} — ${p.platform} — ${p.title}\n`;
    out += `**Hook:** ${p.hook}\n\n`;
    out += `${p.body}\n\n`;
    out += `**Hashtags:** ${(p.hashtags || []).map(h => `#${h}`).join(' ')}\n`;
    out += `**Posting Time:** ${p.postingTime}\n`;
    out += `**Engagement Note:** ${p.engagementNote}\n\n`;
  });
  return out;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = getClientIp(req);
  if (!checkRateLimit(ip)) return res.status(429).json({ error: 'Too many requests. Slow down.' });

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

  const count = Math.min(Math.max(Number(postCount) || 5, 1), 20);
  const systemPrompt = buildSystemPrompt(platforms, contentGoal, frequency, businessContext, competitors);

  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type':      'application/json',
      },
      body: JSON.stringify({
        model:       'claude-sonnet-4-6',
        max_tokens:  8000,
        system:      systemPrompt,
        tools:       [SOCIAL_POSTS_TOOL],
        tool_choice: { type: 'tool', name: 'submit_social_posts' },
        messages: [{
          role:    'user',
          content: `Create ${count} posts distributed across: ${platforms.join(', ')}. Topic/theme: ${topic}. Content goal: ${contentGoal}. Posting cadence: ${frequency}.`,
        }],
      }),
      signal: AbortSignal.timeout(55000),
    });

    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      const errMsg = data.error?.message || `Anthropic error ${upstream.status}`;
      return res.status(upstream.status).json({ error: errMsg });
    }

    const toolUse = data.content?.find(b => b.type === 'tool_use' && b.name === 'submit_social_posts');
    if (!toolUse || !Array.isArray(toolUse.input?.posts) || !toolUse.input.posts.length) {
      return res.status(502).json({ error: 'Claude did not return structured posts. Try again — this is usually transient.' });
    }

    const { contentPlanNote, posts } = toolUse.input;

    return res.json({
      success:         true,
      contentPlanNote,
      posts,
      content:         renderPostsAsMarkdown(contentPlanNote, posts),
      platforms,
      contentGoal,
      postCount:       posts.length,
      usage:           data.usage,
    });

  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
};
