/**
 * api/seo-outreach-draft.js — SEO Pipeline Stage 5b: Outreach Drafting (never sends)
 *
 * POST { prospect: {domain, page_url, relevance_reason}, profile, article? }
 * Returns: { success, subject, body }
 *
 * Drafts ONE personalized outreach email for a human to review and send —
 * this endpoint has no send capability at all. Actually sending happens
 * through the existing, already-QA-gated Resend infrastructure
 * (api/send-campaign.js + Pat's compliance review), the same path email
 * campaigns already go through elsewhere in this app — never a bespoke
 * auto-send path for outreach.
 */

'use strict';

const { requireUser } = require('./_lib/require-user.js');
const { rateLimited } = require('./_lib/rate-limit.js');

const { callClaudeForJSON } = require('./_lib/nancy-claude.js');

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 10;


const OUTREACH_TOOL = {
  name: 'submit_outreach_draft',
  description: 'Submit a short, genuinely personalized outreach email draft.',
  input_schema: {
    type: 'object',
    properties: {
      subject: { type: 'string', description: 'Short, specific, non-spammy subject line — never "Collaboration opportunity" or similar generic spam-trigger phrasing' },
      body: { type: 'string', description: 'Plain-text email body, 80-150 words. Specific to the real page/reason given — never a generic template. No hype, no "I hope this email finds you well". State clearly why you\'re reaching out and what you\'re offering/asking, once.' },
    },
    required: ['subject', 'body'],
  },
};

module.exports = async function handler(req, res) {
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

  if (rateLimited(req, res, { name: 'seo-outreach-draft', max: 10, windowMs: 60 * 1000, auth })) return;

  const { prospect, profile, article, brandVoice, senderContext } = req.body || {};
  if (!prospect || !prospect.domain) return res.status(400).json({ error: 'prospect is required' });
  if (!profile) return res.status(400).json({ error: 'profile is required' });

  const voiceLines = [];
  if (brandVoice?.tone?.length) voiceLines.push(`Voice/tone to write in: ${brandVoice.tone.join(', ')}`);
  if (brandVoice?.avoid) voiceLines.push(`Never say: ${brandVoice.avoid}`);
  if (brandVoice?.notLikeCompetitors) voiceLines.push(`Don't sound like: ${brandVoice.notLikeCompetitors}`);

  const system = `You write short, genuinely personalized backlink-outreach emails — never generic spam templates. Reference the real, specific reason this prospect was identified. If a specific real article/resource is provided, offer it as the concrete value being shared — never invent a resource that doesn't exist. Never use manipulative or spammy language ("boost your rankings", "link exchange", "SEO opportunity"). This must read like a real person wrote it to a real person.${voiceLines.length ? `\n\nMatch this business's brand voice:\n${voiceLines.join('\n')}` : ''}`;

  const user = `PROSPECT: ${prospect.domain}${prospect.page_url ? ` (specifically: ${prospect.page_url})` : ''}
WHY THIS PROSPECT: ${prospect.relevance_reason}

MY BUSINESS: ${profile.business_summary}
${article ? `\nTHE SPECIFIC RESOURCE I'M OFFERING TO SHARE:\nTitle: ${article.title}\nWhat it covers: ${article.meta_description}` : '\n(No specific article to reference yet — write a lighter-touch email simply introducing genuine interest in their content/site, not asking for anything yet.)'}
${senderContext ? `\n${senderContext}\nSign the email off using this identity.` : ''}

Draft the outreach email.`;

  const result = await callClaudeForJSON({ system, user, tool: OUTREACH_TOOL, maxTokens: 800, timeoutMs: 30000 });
  if (!result.success) return res.status(502).json({ success: false, error: result.error });

  return res.json({ success: true, subject: result.data.subject, body: result.data.body });
};
