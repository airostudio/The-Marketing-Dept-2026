/**
 * api/preview-merge.js — "what will this actually look like when it sends."
 *
 * Nothing in Pat's compose flow ever rendered a campaign with real contact
 * data before send — the compose box always showed the raw {{firstName}}
 * template, so a mistyped token ({{first_name}}) or a bracket placeholder
 * ("[First Name]") looked exactly like working personalization right up
 * until send time. This runs the exact same substitution
 * (api/_lib/merge-fields.js) and the exact same pre-send check
 * (api/_lib/content-guard.js) that api/send-campaign.js itself uses, so what
 * this returns is what would actually happen — not a separate guess at it.
 *
 * POST { subject, html, text?, mergeFields }
 * Returns: { subject, html, text, issues: string[], placeholders: string[] }
 *
 * `placeholders` is the raw list of remaining bracket placeholders (a
 * recognizable one like "[First Name]" is already resolved above and won't
 * appear here) — structured, not parsed out of the `issues` prose, so a
 * caller like Pat's compose UI can render one "what should this say?" input
 * per exact placeholder and safely find-and-replace it, rather than asking
 * the person to go edit raw HTML by hand.
 *
 * No Resend call, no quota, no suppression check — this sends nothing and
 * costs nothing, so it only needs to confirm who's asking, not meter them.
 */

'use strict';

const { requireUser } = require('./_lib/require-user.js');
const { withFailureReporting } = require('./_lib/report-failure.js');
const { applyMergeFields, resolveFieldAliases } = require('./_lib/merge-fields.js');
const { checkSendableContent, findBracketPlaceholders } = require('./_lib/content-guard.js');

module.exports = withFailureReporting('api/preview-merge', async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = await requireUser(req, res);
  if (!auth) return;

  const { subject, html, text, mergeFields } = req.body || {};
  if (!subject && !html) return res.status(400).json({ error: 'subject or html is required' });

  const fields = mergeFields && typeof mergeFields === 'object' ? mergeFields : {};
  // Same alias rewrite send-campaign.js applies before merge — the preview
  // has to show what would ACTUALLY be sent, and a resolvable "[First Name]"
  // is not a defect by the time it reaches a real send.
  const rendered = {
    subject: applyMergeFields(resolveFieldAliases(subject || ''), fields),
    html: applyMergeFields(resolveFieldAliases(html || ''), fields),
    text: text !== undefined ? applyMergeFields(resolveFieldAliases(text), fields) : undefined,
  };

  // Checked WITHOUT allowMergeTags: this is post-merge, real-recipient
  // content — a {{token}} still showing here is exactly what would be
  // skipped or refused at actual send time, and the preview should say so.
  const { blocking } = checkSendableContent(rendered);
  const placeholders = findBracketPlaceholders(`${rendered.subject}\n${rendered.html}\n${rendered.text || ''}`);

  return res.json({ ...rendered, issues: blocking, placeholders });
});
