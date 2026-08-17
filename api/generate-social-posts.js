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
// Format bias reflects current (2025-2026) engagement-velocity data: carousels
// are the single highest-engagement organic format on Instagram/LinkedIn/
// Facebook (up to ~3.1x standard posts), and Reels remain the top reach
// format but have shifted toward storytelling/talking-head content over
// short trend-clip mimicry. These are defaults to lean toward, not a rule
// that every single post must be a carousel or Reel — content still needs
// to fit the actual idea.
const PLATFORM_STRATEGY = {
  'LinkedIn': 'Professional register. Hook line must earn the "see more" click within ~2 lines. Long-form (150-300 words) performs for thought leadership; short + punchy for engagement. Native document/carousel framing where relevant — carousels are a genuine engagement goldmine here, default to one unless the idea is clearly a single-point take. No link-in-first-line (algorithm suppresses it) — put links in the first comment if needed.',
  'Instagram': 'Visual-first — caption supports the image/reel/carousel, doesn\'t replace it. Hook in the first line before the "more" fold. Conversational tone. Emojis as visual breaks, not decoration. Strong CTA to save/share/comment, not just like. Default to Carousel or Reel (talking-head/storytelling style, not a fast trend-clip mimic) over a single static image unless the content genuinely only needs one frame.',
  'Twitter/X': 'Conversational, opinionated, native voice. Lead with the take, not a throat-clear. Thread format for multi-point arguments (mark "Post 1/2/3" clearly). No hashtag-stuffing — 0-2 max, and even those secondary to keyword-rich phrasing in the copy itself.',
  'TikTok': 'Caption is secondary to the video/hook — write it as a companion, not a script. Short, punchy, trend-aware language. Native slang where authentic to the brand voice, never forced. Favor a talking-head/storytelling Reel format over a pure trend-audio clip — it reaches new audiences better and ages better than trend-dependent content.',
  'Facebook': 'Community/conversation framing. Questions and relatable statements outperform pure promotion. Slightly longer copy tolerated vs Instagram. Native video/photo framing; carousels perform well here too for multi-point or before/after content.',
};

// ── Content goal → strategic framing ────────────────────────────────────────
const GOAL_STRATEGY = {
  'Thought Leadership': 'Take a genuine point of view — agree/disagree with a common industry belief, back it with real experience or data. Avoid generic "5 tips" filler; a strong POV outperforms a listicle.',
  'Product Launch': 'Lead with the customer outcome, not the feature list. What changes for them? Use a before/after or a specific use case, not a spec sheet.',
  'Case Study': 'Name specifics — the type of customer, the specific problem, the specific result (numbers if available from business context). Vague "great results" content underperforms.',
  'Engagement': 'Ask a genuine question or take a debatable stance people want to respond to. The goal is comments/shares, not just impressions — optimize for reply-worthiness.',
  'Community Building': 'Speak to the audience as peers/insiders. Reference shared frustrations or in-jokes of the space. Behind-the-scenes or "how we think about X" framing works well.',
};

// Defense-in-depth cap on the client-assembled BusinessBrain context. The
// client concatenates several context blocks (ICP hooks, brand voice, value
// props, competitive differentiation, hashtag strategy, researched context)
// with no length cap of its own — an unusually large BusinessBrain profile
// could inflate this well past what's useful, which costs both latency (more
// input to process before the model can start generating) and cache-hit
// reliability (huge blocks are more likely to have already been truncated
// differently between calls). ~24000 chars is roughly 6000 tokens — generous
// for real ICP/brand-voice/value-prop content, well past diminishing returns.
const MAX_BUSINESS_CONTEXT_CHARS = 24000;

// System prompt is built as content blocks (not a single string) so the
// business context — by far the largest and most session-repeated part of
// the input — can be cached separately via cache_control. It's placed FIRST
// so the cached prefix is unaffected by per-call variation in platforms/goal/
// competitors; a user regenerating posts multiple times in a session (a very
// common pattern) then gets a cache hit on that block every time after the
// first, cutting both latency and the risk of tripping the upstream timeout.
// Anthropic requires ~1024 min tokens (Sonnet) for a block to actually cache;
// below that it's simply sent as normal, uncached text — no downside either way.
function buildSystemBlocks(platforms, contentGoal, frequency, businessContext, competitors) {
  const blocks = [];

  const trimmedContext = (businessContext || '').trim();
  if (trimmedContext) {
    const capped = trimmedContext.length > MAX_BUSINESS_CONTEXT_CHARS
      ? trimmedContext.slice(0, MAX_BUSINESS_CONTEXT_CHARS) + '\n[...context truncated for length]'
      : trimmedContext;
    blocks.push({
      type: 'text',
      text: `## BUSINESS CONTEXT (use this — real ICP, brand voice, value props, and pain points, not generic industry language)\n${capped}`,
      cache_control: { type: 'ephemeral' },
    });
  }

  const platformGuides = platforms
    .map(p => `**${p}**: ${PLATFORM_STRATEGY[p] || 'Write in the platform\'s native voice and format.'}`)
    .join('\n');

  let rest = `You are a social media strategist who creates platform-native content that drives genuine engagement — not generic filler that could belong to any brand.

## PLATFORMS REQUESTED
${platformGuides}

## CONTENT GOAL: ${contentGoal}
${GOAL_STRATEGY[contentGoal] || 'Write content that serves this specific goal concretely, not generically.'}

## POSTING CADENCE CONTEXT
${frequency}
`;

  if (!trimmedContext) {
    rest += `\n⚠️ No business context was provided — write the best generic-industry content you can, but flag in contentPlanNote that connecting BusinessBrain would sharpen targeting significantly.\n`;
  }

  if (competitors && competitors.trim()) {
    rest += `\n## COMPETITIVE CONTEXT\nKnown competitors: ${competitors.trim()}. Where a differentiation angle fits naturally, use it — don't force it into every post.\n`;
  }

  rest += `
## HARD RULES
1. Every post needs a real, specific hook — not "Are you struggling with X?" boilerplate. Reference something concrete from the topic/business context.
2. Captions must be keyword-rich, natural-language writing built around the real topic and the ICP's own language — this is now a bigger discovery/algorithm signal than hashtag volume. Hashtags are secondary and still platform-appropriate in count (LinkedIn/Instagram: 3-8; Twitter/X: 0-2; TikTok: 3-6 trend-aware tags), but never a substitute for a keyword-dense caption.
3. Posting time recommendations should reflect real platform behavior patterns (e.g. LinkedIn = weekday mornings, Instagram = evenings/weekends), not a generic "9am" default for every post.
4. No two posts in the batch should share the same hook structure or opening line pattern — genuine variety, not the same template restated.
5. recommendedFormat: default to Carousel or Reel (talking-head/storytelling, not a trend-clip mimic) on platforms that support them, per the platform guide above — a single static image/text post is the exception when the idea genuinely doesn't need multiple frames or motion, not the default choice.
6. When the content goal is promotional (Product Launch, or any post featuring the product/offer), frame it around the specific need/problem it solves — what changes for the customer — rather than a feature description, and where it fits naturally, prompt for user-generated content (encourage followers to share their own photos/videos using it) rather than only asking for likes/comments.
7. storyFollowUp: for posts on platforms with a Stories feature (Instagram, Facebook), suggest ONE simple companion Stories interaction (a poll, quiz, or "Ask Me Anything" prompt) that extends the post's conversation — omit this field entirely (do not include empty string) for platforms without Stories or when nothing genuine fits.
8. Call the submit_social_posts tool with the complete batch. Do not write prose output.`;

  blocks.push({ type: 'text', text: rest });
  return blocks;
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
            platform:         { type: 'string', description: 'Exact platform name from the request, e.g. "LinkedIn"' },
            title:            { type: 'string', description: 'Short internal label for this post, e.g. "The pricing objection post"' },
            hook:             { type: 'string', description: 'The first line — must work as a scroll-stopper on its own' },
            body:             { type: 'string', description: 'Full post copy including the hook as its opening line' },
            hashtags:         { type: 'array', items: { type: 'string' }, description: 'Platform-appropriate hashtags, without the # symbol — secondary to keyword-rich caption writing, not the primary discovery mechanism' },
            recommendedFormat: { type: 'string', description: 'The creative format this post should be shot/built as, e.g. "Carousel (6 slides)", "Reel — talking-head storytelling", "Single image" — default to carousel/Reel per platform guidance unless the idea genuinely needs only one frame' },
            postingTime:      { type: 'string', description: 'Recommended day/time to post, with a one-clause reason' },
            engagementNote:   { type: 'string', description: 'Why this specific post should perform well for this goal/platform' },
            storyFollowUp:    { type: 'string', description: 'Optional: one companion Stories interaction (poll/quiz/AMA) that extends this post\'s conversation — omit entirely for platforms without Stories or when nothing genuine fits' },
          },
          required: ['platform', 'title', 'hook', 'body', 'hashtags', 'recommendedFormat', 'postingTime', 'engagementNote'],
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
    out += `**Format:** ${p.recommendedFormat || 'Not specified'}\n\n`;
    out += `**Hook:** ${p.hook}\n\n`;
    out += `${p.body}\n\n`;
    out += `**Hashtags:** ${(p.hashtags || []).map(h => `#${h}`).join(' ')}\n`;
    out += `**Posting Time:** ${p.postingTime}\n`;
    out += `**Engagement Note:** ${p.engagementNote}\n`;
    if (p.storyFollowUp) out += `**Stories Follow-Up:** ${p.storyFollowUp}\n`;
    out += '\n';
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
  const systemBlocks = buildSystemBlocks(platforms, contentGoal, frequency, businessContext, competitors);

  // Scale the output budget to the batch size instead of always requesting the
  // full 8000-token ceiling — smaller batches finish (and stream back) faster,
  // which matters because the upstream call has to fit inside the function's
  // maxDuration (60s, see vercel.json) alongside request/response overhead.
  const maxTokens = Math.min(8000, 700 * count + 1200);

  // The function's own maxDuration is 60s (vercel.json) — a retry inside this
  // same invocation would blow straight past that ceiling, so there's exactly
  // one attempt. 55s leaves a little headroom for request parsing/response
  // serialization while giving generation itself as much of the 60s budget
  // as possible — output for a full 20-post batch (~8000 tokens) needs real
  // time to generate, and that time comes from token throughput, not from
  // input size, so it isn't something caching the input can shrink.
  const UPSTREAM_TIMEOUT_MS = 55000;

  function isTimeout(err) {
    return err.name === 'TimeoutError' || err.name === 'AbortError' || /aborted due to timeout/i.test(err.message || '');
  }

  try {
    // Streamed, not a single non-streaming fetch: a non-streaming request
    // that takes tens of seconds to produce its one response is exactly the
    // shape most likely to get killed early by an idle-connection timeout
    // somewhere in the network path (proxies/CDNs commonly kill a connection
    // that's gone quiet for ~30s even when the overall request budget is
    // larger) — that reads identically to "Claude took too long" even though
    // Claude was still actively generating. Streaming keeps bytes flowing
    // over the connection the whole time, so it isn't mistaken for hung.
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type':      'application/json',
      },
      body: JSON.stringify({
        model:       'claude-sonnet-4-6',
        max_tokens:  maxTokens,
        system:      systemBlocks,
        tools:       [SOCIAL_POSTS_TOOL],
        tool_choice: { type: 'tool', name: 'submit_social_posts' },
        stream:      true,
        messages: [{
          role:    'user',
          content: `Create ${count} posts distributed across: ${platforms.join(', ')}. Topic/theme: ${topic}. Content goal: ${contentGoal}. Posting cadence: ${frequency}.`,
        }],
      }),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });

    if (!upstream.ok) {
      const errData = await upstream.json().catch(() => ({}));
      const errMsg = errData.error?.message || `Anthropic error ${upstream.status}`;
      return res.status(upstream.status).json({ error: errMsg });
    }

    // Minimal SSE accumulator — we only need the one forced tool_use block's
    // input JSON (built incrementally via input_json_delta events) plus the
    // final usage stats; everything else in the stream is ignored.
    let toolInputJson = '';
    let usage = null;
    let sawToolUse = false;
    let streamError = null;

    // Line-by-line, not a blind split on '\n\n' — SSE frames are terminated
    // by a blank line, but relying on that exact double-newline boundary
    // surviving chunk splits/CRLF line endings intact is fragile. Scanning
    // for individual '\n'-terminated lines and pulling out any that start
    // with "data:" is what SSE parsers actually do, and tolerates a
    // trailing '\r' or a missing/blank blank-line separator without losing
    // every event in the stream.
    let eventCount = 0;
    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    const processLine = (rawLine) => {
      const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
      if (!line.startsWith('data:')) return;
      const jsonStr = line.slice(5).trim();
      if (!jsonStr || jsonStr === '[DONE]') return;

      let payload;
      try {
        payload = JSON.parse(jsonStr);
      } catch {
        return;
      }
      eventCount++;

      if (payload.type === 'content_block_start' && payload.content_block?.type === 'tool_use') {
        sawToolUse = true;
      } else if (payload.type === 'content_block_delta' && payload.delta?.type === 'input_json_delta') {
        toolInputJson += payload.delta.partial_json || '';
      } else if (payload.type === 'message_start') {
        usage = payload.message?.usage || null;
      } else if (payload.type === 'message_delta') {
        usage = { ...(usage || {}), ...(payload.usage || {}) };
      } else if (payload.type === 'error') {
        streamError = payload.error?.message || 'Anthropic stream error';
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (value && value.length) buffer += decoder.decode(value, { stream: true });
      if (done) {
        buffer += decoder.decode();
        if (buffer) processLine(buffer);
        break;
      }
      let newlineIdx;
      while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
        processLine(buffer.slice(0, newlineIdx));
        buffer = buffer.slice(newlineIdx + 1);
      }
    }

    if (streamError) return res.status(502).json({ error: streamError });
    if (!sawToolUse || !toolInputJson) {
      // Logged (not surfaced to the client) so a repeat of this failure shows
      // up in Vercel function logs with enough to tell "stream never parsed
      // any events" apart from "parsed fine, model just didn't call the tool".
      console.error('generate-social-posts: no tool_use captured', { eventCount, sawToolUse, toolInputJsonLength: toolInputJson.length });
      return res.status(502).json({ error: 'Claude did not return structured posts. Try again — this is usually transient.' });
    }

    let toolInput;
    try {
      toolInput = JSON.parse(toolInputJson);
    } catch {
      return res.status(502).json({ error: 'Claude returned malformed structured output. Try again — this is usually transient.' });
    }

    const { contentPlanNote, posts } = toolInput;
    if (!Array.isArray(posts) || !posts.length) {
      return res.status(502).json({ error: 'Claude did not return structured posts. Try again — this is usually transient.' });
    }

    return res.json({
      success:         true,
      contentPlanNote,
      posts,
      content:         renderPostsAsMarkdown(contentPlanNote, posts),
      platforms,
      contentGoal,
      postCount:       posts.length,
      usage,
    });

  } catch (err) {
    if (isTimeout(err)) {
      return res.status(504).json({ error: `Claude took too long generating ${count} posts. Try again, or generate a smaller batch (5-7 posts) if this keeps happening.` });
    }
    return res.status(502).json({ error: err.message });
  }
};
