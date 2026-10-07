/**
 * api/_lib/flow-merge.js — merge-tag handling for automation flows, using the
 * same rules (api/_lib/merge-fields.js, api/_lib/content-guard.js) as a
 * one-off campaign send, so a flow step and a campaign can never disagree
 * about what a tag means.
 *
 *   cleanSenderFields   the {{senderName}}-style values a flow is sent as,
 *                       whitelisted and length-bounded, stored on the flow
 *   buildMergeFields    everything one recipient's email can merge
 *   copyIssues          what is wrong with a step's copy, found when the flow
 *                       is saved (and again at send) rather than at 3am
 */

'use strict';

const { checkSendableContent } = require('./content-guard.js');
const { KNOWN_TOKENS, tokenNames, tokensNeedingFallback, resolveFieldAliases } = require('./merge-fields.js');

const SENDER_KEYS = ['senderName', 'senderFirstName', 'senderTitle', 'senderEmail', 'senderPhone', 'senderCompany'];

/** Only the known sender keys, strings only, bounded. */
function cleanSenderFields(input) {
  const out = {};
  if (!input || typeof input !== 'object') return out;
  for (const k of SENDER_KEYS) {
    const v = input[k];
    if (typeof v === 'string' && v.trim()) out[k] = v.replace(/\s+/g, ' ').trim().slice(0, 120);
  }
  return out;
}

/**
 * One recipient's merge values. Order matters: the contact's own custom
 * fields are laid down first, then the standard columns, then the flow's
 * sender — so a contact's custom field can never impersonate the sender.
 */
function buildMergeFields(contact, senderFields) {
  const c = contact || {};
  return {
    ...((c.custom_fields && typeof c.custom_fields === 'object') ? c.custom_fields : {}),
    firstName: c.first_name || '',
    lastName: c.last_name || '',
    company: c.company || '',
    email: c.email || '',
    ...cleanSenderFields(senderFields),
  };
}

/**
 * Problems with a step's copy, as plain sentences. Empty = fit to send.
 * @param {{subject:string, html:string}} step
 * @param {{senderFields?:object}} [opts]
 */
function copyIssues(step, { senderFields } = {}) {
  const subject = resolveFieldAliases(step.subject || '');
  const html = resolveFieldAliases(step.html || '');
  const issues = [...checkSendableContent({ subject, html, text: '' }, { allowMergeTags: true }).blocking];
  const combined = `${subject}\n${html}`;

  const known = new Set([...KNOWN_TOKENS, 'email']);
  const unknown = tokenNames(combined).filter(t => !known.has(t));
  if (unknown.length) issues.push(`Merge tag${unknown.length === 1 ? '' : 's'} the send system does not know how to fill: ${unknown.map(t => `{{${t}}}`).join(', ')}`);

  const bare = tokensNeedingFallback(combined).filter(t => known.has(t));
  if (bare.length) issues.push(`Add a fallback to ${bare.map(t => `{{${t}}}`).join(', ')} (for example {{${bare[0]}|your area}}) so recipients without it are not skipped.`);

  const sender = cleanSenderFields(senderFields);
  const missingSender = tokenNames(combined).filter(t => SENDER_KEYS.includes(t) && !sender[t]);
  if (missingSender.length) issues.push(`This flow uses ${missingSender.map(t => `{{${t}}}`).join(', ')} but has no sender set. Pick who it is sent as (Business Brain contact) first.`);

  return issues;
}

module.exports = { SENDER_KEYS, cleanSenderFields, buildMergeFields, copyIssues };
