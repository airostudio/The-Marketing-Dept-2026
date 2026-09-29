/**
 * api/generate-campaign-sequence.js — a deliberately ordered multi-post
 * organic campaign, built around a narrative arc rather than independent
 * variants.
 *
 * POST {
 *   platform:        string,   // single platform this sequence targets, default 'LinkedIn'
 *   painPoint:       string,   // the core problem/insight the campaign is built around
 *   product:         string,   // what's being offered, introduced only at the final stage
 *   audience:        string,   // who this is for
 *   postCount:       number,   // 3-7, default 7 (see FUNNEL_STAGES — the arc below is a 7-stage one)
 *   businessContext?: string,  // pre-assembled BusinessBrain context from the client
 *   tone?:           string,
 * }
 *
 * Returns: {
 *   success: true,
 *   campaignNote: string,
 *   posts: [{ sequencePosition, funnelStage, hook, title, body, hashtags, purpose }],
 *   content: string,  // markdown rendering
 *   platform, postCount, usage
 * }
 *
 * Every other generator in this codebase (generate-social-posts.js,
 * generate-ads.js) deliberately produces INDEPENDENT posts/variants —
 * generate-social-posts.js even has a hard rule that no two posts in a batch
 * may share a hook structure, which is exactly wrong for a campaign meant to
 * build on itself. This is the one place a genuine narrative sequence gets
 * generated: post 1 names the problem with no mention of the product, and
 * only the final post introduces it — mirroring how a real pain-amplification
 * LinkedIn campaign is actually run (organic recognition first, pitch last).
 *
 * Uses the same streamed-SSE + 145s-timeout shape as generate-social-posts.js
 * and generate-ads.js — both of those had to be fixed after shipping with a
 * blocking, short-timeout call for the identical forced-tool-call-with-a-lot-
 * of-output shape; built correctly here from the start rather than needing a
 * third round of that same bug.
 *
 * Uses Claude claude-sonnet-4-6. Requires ANTHROPIC_API_KEY env var.
 */

'use strict';

const { requireUser } = require('./_lib/require-user.js');
const { withFailureReporting } = require('./_lib/report-failure.js');
const { rateLimited } = require('./_lib/rate-limit.js');
const { anthropicHeaders } = require('./_lib/anthropic-headers.js');

const RATE_LIMIT_WINDOW = 60 * 1000;
const RATE_LIMIT_MAX    = 6;

// The arc a real pain-amplification campaign follows: name the problem, make
// it hurt, prove it's real and it's costing them, name the excuse people use
// to avoid dealing with it, reposition the moment, then — and only then —
// the product. A shorter postCount takes an evenly-spaced subset of this,
// always keeping the first ('pain') and last ('solution') stages.
const FUNNEL_STAGES = [
  { key: 'pain', label: 'Pain', instruction: 'Name the exact frustration in the audience\'s own words. Zero mention of the product, brand, or a solution — this post is recognition only. End with a low-friction invitation to react (e.g. a specific emoji or one-word reply) rather than a hard CTA.' },
  { key: 'agitate', label: 'Agitate', instruction: 'Amplify the cost of the pain continuing — what it does to their confidence, their customers\' trust, or their day-to-day. Still no product mention. Make the discomfort concrete and specific, not abstract.' },
  { key: 'proof', label: 'Social Proof / Contrast', instruction: 'Show they are not alone in this, or contrast them against competitors/peers who have already moved past this problem. Still no product mention — this is about the feeling of being behind, not a pitch.' },
  { key: 'cost-of-inaction', label: 'Cost of Inaction', instruction: 'Quantify what NOT fixing this is actually costing them — lost trust, lost customers, lost time, missed opportunities. Concrete and specific beats vague. Still no product mention.' },
  { key: 'objection', label: 'Objection / Procrastination', instruction: 'Name the exact excuse people tell themselves to avoid dealing with this ("I\'ll fix it eventually", "it\'s not that bad", "I don\'t have time right now") and gently dismantle it. Still no product mention.' },
  { key: 'positioning', label: 'Positioning', instruction: 'Reframe the moment: their business/situation has moved on, but the thing causing the pain hasn\'t kept up. This is the bridge post — still no explicit product pitch, but it should make the reader feel ready for what comes next.' },
  { key: 'solution', label: 'Solution', instruction: 'Now, and only now, introduce the product/brand as the answer to everything the previous posts built up. Make the connection to the earlier pain explicit. This is the only post that should carry a real CTA.' },
];

function pickStages(count) {
  const n = Math.min(Math.max(Number(count) || 7, 3), FUNNEL_STAGES.length);
  if (n === FUNNEL_STAGES.length) return FUNNEL_STAGES;
  // Evenly spaced indices across the full arc, always including the first and last.
  const indices = new Set([0, FUNNEL_STAGES.length - 1]);
  for (let i = 1; indices.size < n; i++) {
    indices.add(Math.round((i * (FUNNEL_STAGES.length - 1)) / (n - 1)));
  }
  return [...indices].sort((a, b) => a - b).map(i => FUNNEL_STAGES[i]);
}

const MAX_BUSINESS_CONTEXT_CHARS = 24000;

function buildSystemBlocks(platform, painPoint, product, audience, tone, businessContext, stages) {
  const blocks = [];

  const trimmedContext = (businessContext || '').trim();
  if (trimmedContext) {
    const capped = trimmedContext.length > MAX_BUSINESS_CONTEXT_CHARS
      ? trimmedContext.slice(0, MAX_BUSINESS_CONTEXT_CHARS) + '\n[...context truncated for length]'
      : trimmedContext;
    blocks.push({
      type: 'text',
      text: `## BUSINESS CONTEXT (use this — real ICP, brand voice, value props)\n${capped}`,
      cache_control: { type: 'ephemeral' },
    });
  }

  const stageInstructions = stages.map((s, i) =>
    `### Post ${i + 1} — ${s.label}\n${s.instruction}`
  ).join('\n\n');

  let rest = `You are a direct-response copywriter running a ${platform} pain-amplification campaign — a deliberate sequence of posts that builds recognition and engagement BEFORE the product is ever mentioned, then closes on it.

## CAMPAIGN BRIEF
- **Core pain/insight:** ${painPoint}
- **Product/Offer (do not mention until the final post):** ${product}
- **Audience:** ${audience}
${tone ? `- **Brand tone:** ${tone}` : ''}

## THE ARC — write these ${stages.length} posts, in this exact order, each building on the last
${stageInstructions}

## HARD RULES
1. Posts ${stages.length > 1 ? `1 through ${stages.length - 1}` : '1'} must NOT name the product/brand — this is the entire point of the arc. Only the final ("Solution") post does.
2. Every post's hook must work as a scroll-stopper on its own — the first two lines especially, since ${platform} truncates behind "see more".
3. Each post must feel like part of the same continuing conversation with the reader (consistent voice, callback-able language) without literally repeating lines from earlier posts.
4. hashtags: platform-appropriate count and style, secondary to keyword-rich writing.
5. purpose: one sentence stating what this specific post is trying to make the reader feel or do.
6. Call the submit_campaign_sequence tool with the complete sequence. Do not write prose output.`;

  if (!trimmedContext) {
    rest = `⚠️ No business context was provided — write the best generic-but-specific content you can from the brief alone.\n\n` + rest;
  }

  blocks.push({ type: 'text', text: rest });
  return blocks;
}

const CAMPAIGN_SEQUENCE_TOOL = {
  name: 'submit_campaign_sequence',
  description: 'Submit the complete ordered campaign sequence, one object per post, in the exact order they should be posted.',
  input_schema: {
    type: 'object',
    properties: {
      campaignNote: {
        type: 'string',
        description: 'A 2-4 sentence overview of the arc and how it builds from post to post.',
      },
      posts: {
        type: 'array',
        description: 'One object per post, in posting order.',
        items: {
          type: 'object',
          properties: {
            sequencePosition: { type: 'integer', description: '1-based position in the sequence' },
            funnelStage:      { type: 'string', description: 'The stage label from the brief, e.g. "Pain", "Agitate", "Solution"' },
            title:            { type: 'string', description: 'Short internal label for this post' },
            hook:             { type: 'string', description: 'The first line — must work as a scroll-stopper on its own' },
            body:             { type: 'string', description: 'Full post copy including the hook as its opening line' },
            hashtags:         { type: 'array', items: { type: 'string' }, description: 'Without the # symbol' },
            purpose:          { type: 'string', description: 'What this post is trying to make the reader feel or do' },
          },
          required: ['sequencePosition', 'funnelStage', 'title', 'hook', 'body', 'hashtags', 'purpose'],
        },
      },
    },
    required: ['campaignNote', 'posts'],
  },
};

function renderSequenceAsMarkdown(campaignNote, posts) {
  let out = `**Campaign Arc:** ${campaignNote}\n\n`;
  posts.forEach((p) => {
    out += `---\n## Post ${p.sequencePosition} — ${p.funnelStage} — ${p.title}\n`;
    out += `**Hook:** ${p.hook}\n\n`;
    out += `${p.body}\n\n`;
    out += `**Hashtags:** ${(p.hashtags || []).map(h => `#${h}`).join(' ')}\n`;
    out += `**Purpose:** ${p.purpose}\n\n`;
  });
  return out;
}

module.exports = withFailureReporting('api/generate-campaign-sequence', async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = await requireUser(req, res);
  if (!auth) return;

  if (rateLimited(req, res, { name: 'generate-campaign-sequence', max: RATE_LIMIT_MAX, windowMs: RATE_LIMIT_WINDOW, auth })) return;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });

  const {
    platform        = 'LinkedIn',
    painPoint,
    product,
    audience,
    postCount       = 7,
    businessContext = '',
    tone            = '',
  } = req.body || {};

  if (!painPoint || !product || !audience) {
    return res.status(400).json({ error: 'painPoint, product, and audience are required' });
  }

  const stages = pickStages(postCount);
  const systemBlocks = buildSystemBlocks(platform, painPoint, product, audience, tone, businessContext, stages);
  const maxTokens = Math.min(8000, 900 * stages.length + 1200);

  // Same 145s streamed-SSE shape as generate-social-posts.js/generate-ads.js —
  // see their own comments for why a non-streaming call with a short abort
  // is the wrong shape for a forced tool call producing this much output.
  const UPSTREAM_TIMEOUT_MS = 145000;

  function isTimeout(err) {
    return err.name === 'TimeoutError' || err.name === 'AbortError' || /aborted due to timeout/i.test(err.message || '');
  }

  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: anthropicHeaders(apiKey),
      body: JSON.stringify({
        model:       'claude-sonnet-4-6',
        max_tokens:  maxTokens,
        system:      systemBlocks,
        tools:       [CAMPAIGN_SEQUENCE_TOOL],
        tool_choice: { type: 'tool', name: 'submit_campaign_sequence' },
        stream:      true,
        messages: [{
          role:    'user',
          content: `Write the complete ${stages.length}-post campaign sequence now, in order. Platform: ${platform}.`,
        }],
      }),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });

    if (!upstream.ok) {
      const errData = await upstream.json().catch(() => ({}));
      const errMsg = errData.error?.message || `Anthropic error ${upstream.status}`;
      return res.status(upstream.status).json({ error: errMsg });
    }

    let toolInputJson = '';
    let usage = null;
    let sawToolUse = false;
    let streamError = null;
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
      console.error('generate-campaign-sequence: no tool_use captured', { eventCount, sawToolUse, toolInputJsonLength: toolInputJson.length });
      return res.status(502).json({ error: 'Claude did not return a structured campaign sequence. Try again — this is usually transient.' });
    }

    let toolInput;
    try {
      toolInput = JSON.parse(toolInputJson);
    } catch {
      return res.status(502).json({ error: 'Claude returned malformed structured output. Try again — this is usually transient.' });
    }

    const { campaignNote, posts } = toolInput;
    if (!Array.isArray(posts) || !posts.length) {
      return res.status(502).json({ error: 'Claude did not return a structured campaign sequence. Try again — this is usually transient.' });
    }
    posts.sort((a, b) => (a.sequencePosition || 0) - (b.sequencePosition || 0));

    return res.json({
      success:      true,
      campaignNote,
      posts,
      content:      renderSequenceAsMarkdown(campaignNote, posts),
      platform,
      postCount:    posts.length,
      usage,
    });

  } catch (err) {
    if (isTimeout(err)) {
      return res.status(504).json({ error: `Claude took too long writing this campaign sequence. Try again, or generate fewer posts if this keeps happening.` });
    }
    return res.status(502).json({ error: err.message });
  }
});
