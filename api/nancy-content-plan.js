/**
 * api/nancy-content-plan.js — Nancy Agents 5+6: Content Planner + Copywriter
 *
 * POST {
 *   businessProfile, brand, strategy, personalization, previousTopics?,
 *   dayRange?: [start, end],   // defaults to [1,7] — pass [1,4]/[5,7] to
 *                              // generate the week in two smaller batches
 *   priorPosts?: [{day, objective, content_pillar, hook}],  // already-
 *                              // generated days, for continuity + no repeats
 * }
 * Returns: { success, week_rationale?, posts: [ ...post concepts for the
 *   requested dayRange... ] }
 *
 * Generating all 7 fully-detailed posts (hook, headline, slide copy,
 * caption, cta, hashtags, visual direction, research basis — each) in one
 * call was truncating past even a generous token budget. Rather than keep
 * raising maxTokens indefinitely, the client now calls this endpoint twice
 * — days 1-4, then days 5-7 — so each single call has to produce roughly
 * half the content, comfortably inside a safe budget. Both calls still see
 * the full business/strategy context and the whole 7-day framework, so the
 * week reads as one coordinated sequence, not two disconnected halves.
 *
 * personalization = the Step 7 questionnaire answers:
 *   { goal, focusOffer, faceComfort, style, mustTalkAbout }
 * previousTopics = topics used in earlier weeks (Create Another Week), so
 * the model avoids repeating itself — passed through, never invented here.
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

const DAY_FRAMEWORK = {
  1: 'Authority — strong insight demonstrating expertise.',
  2: 'Education — a useful framework or explanation.',
  3: 'Founder/Personal — uses the user\'s photo and a human perspective (only if the user is comfortable being the face of the brand).',
  4: 'Problem Awareness — a customer problem or common mistake.',
  5: 'Infographic — visualizes something useful from the research (format MUST be "Infographic" for this day).',
  6: 'Differentiation — the brand\'s own approach/point of view.',
  7: 'Conversion — moves the audience toward an enquiry, booking, or purchase.',
};

function buildTool(days, includeRationale) {
  const properties = {
    posts: {
      type: 'array',
      minItems: days.length,
      maxItems: days.length,
      items: {
        type: 'object',
        properties: {
          day: { type: 'integer', enum: days },
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
  };
  const required = ['posts'];
  if (includeRationale) {
    properties.week_rationale = { type: 'string', description: '2-3 sentences on why this specific 7-day mix was chosen for this business — covering the whole week, even though you\'re only writing some of its posts right now' };
    required.unshift('week_rationale');
  }
  return {
    name: 'submit_content_plan_batch',
    description: `Submit ${days.length} coordinated Instagram post concept(s) for day(s) ${days.join(', ')} of the week.`,
    input_schema: { type: 'object', properties, required },
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = getClientIp(req);
  if (!checkRateLimit(ip)) return res.status(429).json({ error: 'Too many requests. Slow down.' });

  const { businessProfile, brand, strategy, personalization = {}, previousTopics = [], dayRange = [1, 7], priorPosts = [] } = req.body || {};
  if (!businessProfile || !strategy) return res.status(400).json({ error: 'businessProfile and strategy are required' });

  const [start, end] = dayRange;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end > 7 || start > end) {
    return res.status(400).json({ error: 'dayRange must be [start, end] with 1 <= start <= end <= 7' });
  }
  const days = Array.from({ length: end - start + 1 }, (_, i) => start + i);
  const includeRationale = start === 1;

  const fullFramework = Object.entries(DAY_FRAMEWORK).map(([d, desc]) => `Day ${d} ${desc}`).join('\n');
  const requestedFramework = days.map(d => `Day ${d} ${DAY_FRAMEWORK[d]}`).join('\n');

  const system = `You are a social media strategist and copywriter building one deliberate week of Instagram content — seven posts working together as a sequence, not seven unrelated ideas. You are being asked to write only SOME of those seven posts in this call (days ${days.join(', ')}); another call is handling the rest. Keep the whole week's arc in mind for tone/continuity even though you're only outputting today's subset.

Full week framework (for context — adapt the mix if this business genuinely calls for something different, but stay consistent with whatever framework you're implied to be following across both calls):
${fullFramework}

You are writing ONLY these days right now:
${requestedFramework}

Hard rules:
- Keep every field within the length noted in its schema description — these graphics are 1080x1350px, real space is limited, and captions are meant to be read in a feed, not scrolled through as an essay. Concise beats exhaustive.
- Every caption must sound like THIS business, using its actual voice/phrases where available — never generic AI marketing copy.
- Ban these phrases entirely: "in today's fast-paced world", "game changer", "unlock the power of", "whether you're...", excessive emojis, excessive hashtags (max 8, and only when genuinely useful).
- Each hook must work standing completely alone, out of context.
- Use the strategy's content_opportunities and where_opportunity_is to ground topic choices — do not generate generic ideas untethered from the research.
- Never copy any competitor's actual wording — use them only as market intelligence about patterns and gaps.
- Respect the user's personalization answers: if faceComfort is "Don't use me" or "Mostly graphics", uses_user_photo must be false on every post (including a Founder/Personal day — reframe it as team/process/behind-the-scenes instead).
- Do not repeat any topic already used in previousTopics, or in the already-written posts from the other call (see below).`;

  const priorPostsNote = priorPosts.length
    ? `\n\nPOSTS ALREADY WRITTEN FOR OTHER DAYS THIS WEEK (do not repeat these topics/angles/hooks):\n${JSON.stringify(priorPosts, null, 2)}`
    : '';

  const user = `BUSINESS PROFILE:\n${JSON.stringify(businessProfile, null, 2)}\n\nBRAND:\n${JSON.stringify(brand || {}, null, 2)}\n\nSTRATEGY:\n${JSON.stringify(strategy, null, 2)}\n\nPERSONALIZATION ANSWERS:\n${JSON.stringify(personalization, null, 2)}\n\nTOPICS ALREADY USED IN PREVIOUS WEEKS (do not repeat):\n${JSON.stringify(previousTopics)}${priorPostsNote}\n\nProduce the content plan for day(s) ${days.join(', ')}${includeRationale ? ', plus the overall week_rationale' : ''}.`;

  const tool = buildTool(days, includeRationale);

  // Scaled to the actual batch size (as small as a single day when the
  // client requests one post per call) instead of one fixed number sized
  // for the largest possible batch — a 1-post call gets a small, safe
  // budget and finishes fast; a larger batch still gets real headroom
  // against max_tokens. ~900 tokens/post covers the schema's length
  // budgets with room to spare, plus a fixed overhead for week_rationale.
  const maxTokens = Math.min(7000, days.length * 900 + (includeRationale ? 300 : 0) + 400);
  const result = await callClaudeForJSON({ system, user, tool, maxTokens, timeoutMs: 45000 });
  if (!result.success) return res.status(502).json({ success: false, error: result.error });

  return res.json({
    success: true,
    week_rationale: result.data.week_rationale || null,
    posts: result.data.posts,
  });
};
