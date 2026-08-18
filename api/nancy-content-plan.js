/**
 * api/nancy-content-plan.js — Nancy Agents 5+6: Content Planner + Copywriter
 *
 * POST { businessProfile, brand, strategy, personalization, previousTopics? }
 * Returns: { success, posts: [ ...seven post concepts per the spec schema... ] }
 *
 * personalization = the Step 7 questionnaire answers:
 *   { goal, focusOffer, faceComfort, style, mustTalkAbout }
 * previousTopics = topics used in earlier weeks (Create Another Week), so
 * the model avoids repeating itself — passed through, never invented here.
 */

'use strict';

const { callClaudeForJSON } = require('./_lib/nancy-claude.js');

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 5;
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

const CONTENT_PLAN_TOOL = {
  name: 'submit_weekly_content_plan',
  description: 'Submit exactly 7 coordinated Instagram post concepts forming a deliberate weekly sequence.',
  input_schema: {
    type: 'object',
    properties: {
      week_rationale: { type: 'string', description: '2-3 sentences on why this specific mix of 7 days was chosen for this business' },
      posts: {
        type: 'array',
        minItems: 7,
        maxItems: 7,
        items: {
          type: 'object',
          properties: {
            day: { type: 'integer', minimum: 1, maximum: 7 },
            objective: { type: 'string', description: 'e.g. Authority, Education, Founder/Personal, Problem Awareness, Infographic, Differentiation, Conversion' },
            content_pillar: { type: 'string' },
            format: { type: 'string', description: 'e.g. "Single graphic", "Carousel — 4 slides", "Infographic"' },
            hook: { type: 'string', description: 'Must work as a scroll-stopper standing alone — no AI clichés. Max ~12 words.' },
            slide_headline: { type: 'string', description: 'Short headline text rendered ON the graphic itself — max ~8 words, must read at a glance' },
            slide_copy: { type: 'string', description: 'Supporting text rendered on the graphic. For a normal day: max ~20 words. For the Infographic day: up to 5 short lines (one per finding), each under 12 words — this is parsed into separate numbered rows on the graphic, not read as one paragraph.' },
            caption: { type: 'string', description: 'The actual Instagram caption — sounds like this specific business, not generic AI copy. 2-5 short paragraphs, roughly 60-120 words total — a real caption, not an essay.' },
            cta: { type: 'string' },
            visual_direction: { type: 'string', description: 'Creative direction for the designer/renderer' },
            uses_user_photo: { type: 'boolean' },
            research_basis: { type: 'string', description: 'What research/strategy finding this post is grounded in' },
            hashtags: { type: 'array', items: { type: 'string' }, maxItems: 8 },
          },
          required: ['day', 'objective', 'content_pillar', 'format', 'hook', 'slide_headline', 'caption', 'cta', 'visual_direction', 'uses_user_photo', 'hashtags'],
        },
      },
    },
    required: ['week_rationale', 'posts'],
  },
};

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = getClientIp(req);
  if (!checkRateLimit(ip)) return res.status(429).json({ error: 'Too many requests. Slow down.' });

  const { businessProfile, brand, strategy, personalization = {}, previousTopics = [] } = req.body || {};
  if (!businessProfile || !strategy) return res.status(400).json({ error: 'businessProfile and strategy are required' });

  const system = `You are a social media strategist and copywriter building one deliberate week of Instagram content — seven posts working together as a sequence, not seven unrelated ideas.

Default sequence to adapt (change the mix if this business genuinely calls for something different):
Day 1 Authority — strong insight demonstrating expertise.
Day 2 Education — a useful framework or explanation.
Day 3 Founder/Personal — uses the user's photo and a human perspective (only if the user is comfortable being the face of the brand).
Day 4 Problem Awareness — a customer problem or common mistake.
Day 5 Infographic — visualizes something useful from the research (format MUST be "Infographic" for this day).
Day 6 Differentiation — the brand's own approach/point of view.
Day 7 Conversion — moves the audience toward an enquiry, booking, or purchase.

Hard rules:
- Keep every field within the length noted in its schema description — these graphics are 1080x1350px, real space is limited, and captions are meant to be read in a feed, not scrolled through as an essay. Concise beats exhaustive.
- Every caption must sound like THIS business, using its actual voice/phrases where available — never generic AI marketing copy.
- Ban these phrases entirely: "in today's fast-paced world", "game changer", "unlock the power of", "whether you're...", excessive emojis, excessive hashtags (max 8, and only when genuinely useful).
- Each hook must work standing completely alone, out of context.
- Use the strategy's content_opportunities and where_opportunity_is to ground topic choices — do not generate generic ideas untethered from the research.
- Never copy any competitor's actual wording — use them only as market intelligence about patterns and gaps.
- Respect the user's personalization answers: if faceComfort is "Don't use me" or "Mostly graphics", uses_user_photo must be false on every post (including Day 3 — reframe it as team/process/behind-the-scenes instead).
- Do not repeat any topic already used in previousTopics.`;

  const user = `BUSINESS PROFILE:\n${JSON.stringify(businessProfile, null, 2)}\n\nBRAND:\n${JSON.stringify(brand || {}, null, 2)}\n\nSTRATEGY:\n${JSON.stringify(strategy, null, 2)}\n\nPERSONALIZATION ANSWERS:\n${JSON.stringify(personalization, null, 2)}\n\nTOPICS ALREADY USED IN PREVIOUS WEEKS (do not repeat):\n${JSON.stringify(previousTopics)}\n\nProduce the 7-day content plan.`;

  // 7000 (up from 6000): the explicit per-field length limits above should
  // keep actual usage well under this, but real captions can run long —
  // this is headroom against truncation (stop_reason:'max_tokens' cutting
  // the tool-call JSON off mid-object, which fails to parse), not an
  // invitation to write more.
  const result = await callClaudeForJSON({ system, user, tool: CONTENT_PLAN_TOOL, maxTokens: 7000, timeoutMs: 50000 });
  if (!result.success) return res.status(502).json({ success: false, error: result.error });

  return res.json({ success: true, week_rationale: result.data.week_rationale, posts: result.data.posts });
};
