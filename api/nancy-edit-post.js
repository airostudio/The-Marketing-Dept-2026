/**
 * api/nancy-edit-post.js — post editor actions: regenerate headline,
 * rewrite caption, make more playful/premium/direct, etc.
 *
 * POST { post: {...one post object...}, instruction: string, businessProfile?, brand? }
 * Returns: { success, post: {...same shape, revised fields...} }
 *
 * Only rewrites the fields implied by the instruction — never regenerates
 * the whole week for a single-post edit (matches the spec's editor requirement).
 */

'use strict';

const { callClaudeForJSON } = require('./_lib/nancy-claude.js');

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 15;
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

const EDIT_TOOL = {
  name: 'submit_revised_post',
  description: 'Submit the revised post fields.',
  input_schema: {
    type: 'object',
    properties: {
      hook: { type: 'string' },
      slide_headline: { type: 'string' },
      slide_copy: { type: 'string' },
      caption: { type: 'string' },
      cta: { type: 'string' },
    },
    required: ['hook', 'slide_headline', 'slide_copy', 'caption', 'cta'],
  },
};

const INSTRUCTION_GUIDANCE = {
  'regenerate headline': 'Write a fresh hook and slide_headline only — keep caption, cta, and slide_copy as close to the original as possible.',
  'rewrite caption': 'Rewrite the caption with a different angle — keep hook, slide_headline, slide_copy, and cta unchanged unless the new caption genuinely requires a cta tweak.',
  'more playful': 'Rewrite all fields to be noticeably more playful and light in tone, while staying true to the brand voice — not silly or off-brand.',
  'more premium': 'Rewrite all fields to feel more premium, polished, and considered — less casual, more authoritative.',
  'more direct': 'Rewrite all fields to be blunter and more direct — cut hedging language, get to the point faster.',
};

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = getClientIp(req);
  if (!checkRateLimit(ip)) return res.status(429).json({ error: 'Too many requests. Slow down.' });

  const { post, instruction, businessProfile = {}, brand = {} } = req.body || {};
  if (!post || !instruction) return res.status(400).json({ error: 'post and instruction are required' });

  const guidance = INSTRUCTION_GUIDANCE[instruction.toLowerCase()] || `Follow this instruction: ${instruction}`;

  const system = `You revise a single Instagram post's copy. ${guidance} Keep the same content_pillar/objective for this day — you're refining, not replacing the concept. Avoid AI clichés ("in today's fast-paced world", "game changer", "unlock the power of", "whether you're...", excessive emojis/hashtags). Sound like this specific business.`;

  const user = `BUSINESS: ${JSON.stringify(businessProfile)}\nBRAND VOICE: ${JSON.stringify(brand.brand_personality || businessProfile.brand_voice || [])}\n\nCURRENT POST:\n${JSON.stringify(post, null, 2)}\n\nInstruction: ${instruction}`;

  const result = await callClaudeForJSON({ system, user, tool: EDIT_TOOL, maxTokens: 1200 });
  if (!result.success) return res.status(502).json({ success: false, error: result.error });

  return res.json({ success: true, post: { ...post, ...result.data } });
};
