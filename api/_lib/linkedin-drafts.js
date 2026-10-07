/**
 * api/_lib/linkedin-drafts.js — write personalised LinkedIn connection notes
 * and follow-up messages for people the user has listed, and refuse any draft
 * that claims knowledge it was not given.
 *
 * LinkedIn's terms forbid automating connection requests and messages, so
 * nothing here ever sends anything or touches LinkedIn: these are drafts for
 * the person to review and send themselves.
 *
 * What a draft may know: the prospect's name, title, company, an optional note
 * the user typed about them, and the sender's own name/company/offer. That is
 * all. Code checks every draft:
 *   - the connection note fits LinkedIn's free-account limit (200 characters)
 *     and carries no link or pitch;
 *   - no unfilled [placeholder];
 *   - no figure that is not in the inputs;
 *   - no claim of having seen, read or admired anything of theirs ("I saw your
 *     post", "congratulations on…") unless the user supplied a note that could
 *     back it.
 * A draft that fails is rewritten ONCE with the exact problems listed; if it
 * still fails it is returned flagged and left out on approval.
 */

'use strict';

const { callClaudeForJSON } = require('./nancy-claude.js');
const { findBracketPlaceholders } = require('./content-guard.js');
const { verifyNumbers } = require('./analytics-facts.js');
const { directive: languageDirective } = require('./writing-language.js');

const NOTE_LIMIT = 200;        // LinkedIn free accounts; premium allows more, so this is safe for everyone
const FOLLOWUP_LIMIT = 600;
const MAX_PROSPECTS = 10;

const FAMILIARITY_RE = /\b(i\s+(saw|noticed|read|came\s+across|followed|watched|loved|enjoyed|admire[d]?|was\s+(impressed|inspired))|(saw|read|loved|enjoyed)\s+your|your\s+(recent\s+)?(post|article|talk|podcast|presentation|work\s+on|journey)|congrat(s|ulations)|great\s+(post|article|work)|impressed\s+(by|with))\b/i;
const LINK_RE = /https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|io|co|ai)\b/i;

const TOOL = {
  name: 'submit_linkedin_drafts',
  description: 'Submit one connection note and one follow-up per prospect.',
  input_schema: {
    type: 'object',
    properties: {
      drafts: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'The prospect id exactly as given.' },
            connectionNote: { type: 'string', description: `The note sent with the connection request. Under ${NOTE_LIMIT} characters. A reason to connect — NOT a pitch. No links.` },
            followUp: { type: 'string', description: `The message to send AFTER they accept. Under ${FOLLOWUP_LIMIT} characters. One low-pressure ask.` },
          },
          required: ['id', 'connectionNote', 'followUp'],
        },
      },
    },
    required: ['drafts'],
  },
};

const SYSTEM_PROMPT = `You write LinkedIn outreach for a small business owner — one connection note and one follow-up per person, each sounding like a real human who wrote it for that person.

Hard rules — each exists because breaking it gets a connection request ignored, reported, or a sender's account restricted:
- Use ONLY the facts given: the person's name, title, company, an optional NOTE the sender typed about them, and the sender's own details. Nothing else is known about the person.
- NEVER claim to have seen, read, followed, watched or admired anything of theirs, and never congratulate them on anything, unless their NOTE says so. If there is no NOTE, the only honest reason to connect is their role and the sender's field — say that.
- Connection note: under ${NOTE_LIMIT} characters, a reason to connect, no pitch, no link, no question that demands work from them.
- Follow-up: under ${FOLLOWUP_LIMIT} characters, only sent after they accept. Say plainly what the sender does and make ONE low-pressure ask. No fake urgency, no flattery, no "quick call?" demands.
- Never invent a statistic, result, client, deadline or mutual connection. No [bracketed placeholders]. No emojis. No links.
- Address the person by the first name given; sign off with the sender's name given.
- Each person's messages must differ from the others' in wording, not just the name.`;

/** Everything wrong with one draft, in plain words ([] = fine). */
function problemsWith(draft, prospect, facts) {
  const p = [];
  const note = String(draft.connectionNote || '').trim(), fu = String(draft.followUp || '').trim();
  if (!note) p.push('The connection note is empty.');
  else if (note.length > NOTE_LIMIT) p.push(`The connection note is ${note.length} characters — the limit is ${NOTE_LIMIT}.`);
  if (!fu) p.push('The follow-up is empty.');
  else if (fu.length > FOLLOWUP_LIMIT) p.push(`The follow-up is ${fu.length} characters — keep it under ${FOLLOWUP_LIMIT}.`);
  const both = `${note}\n${fu}`;
  if (LINK_RE.test(note)) p.push('The connection note contains a link.');
  if (findBracketPlaceholders(both).length) p.push('There is an unfilled [placeholder].');
  const bad = verifyNumbers(both, facts);
  if (bad.length) p.push(`It states figures that were not provided: ${bad.join(', ')}.`);
  if (!String(prospect.note || '').trim() && FAMILIARITY_RE.test(both)) p.push('It claims to have seen or admired something of theirs, but nothing about them was provided to back that up.');
  return p;
}

async function writeOnce(prospects, seller, { language, fix }) {
  const user = [
    `SENDER:\n${JSON.stringify(seller, null, 2)}`,
    `PEOPLE (the only facts known about them):\n${JSON.stringify(prospects.map(p => ({ id: p.id, name: p.name, title: p.title || null, company: p.company || null, note: p.note || null })), null, 2)}`,
    fix ? `\nThese drafts failed checks — rewrite ONLY these people's drafts, fixing exactly the problems listed:\n${JSON.stringify(fix, null, 2)}` : '',
  ].filter(Boolean).join('\n\n');
  const r = await callClaudeForJSON({ system: SYSTEM_PROMPT + (languageDirective(language) ? '\n\n' + languageDirective(language) : ''), user, tool: TOOL, maxTokens: 3500, timeoutMs: 55000 });
  if (!r.success) throw new Error(r.error);
  return Array.isArray(r.data.drafts) ? r.data.drafts : [];
}

/**
 * @param {Array<{id,name,title?,company?,note?}>} prospects
 * @param {{name, title?, company?, offer}} seller
 */
async function buildDrafts(prospects, seller, opts = {}, deps = {}) {
  const write = deps.write || writeOnce;
  const list = prospects.slice(0, MAX_PROSPECTS);
  const byId = new Map(list.map(p => [p.id, p]));
  const factsFor = (p) => ({ prospect: { name: p.name, title: p.title, company: p.company, note: p.note }, seller });

  let drafts = await write(list, seller, opts);
  const result = new Map();
  const check = (d) => {
    const p = byId.get(String(d.id));
    if (!p) return null;
    return { id: p.id, connectionNote: String(d.connectionNote || '').trim(), followUp: String(d.followUp || '').trim(), problems: problemsWith(d, p, factsFor(p)) };
  };
  drafts.forEach(d => { const c = check(d); if (c) result.set(c.id, c); });

  // One rewrite for whoever failed or was missed, with their exact problems.
  const failing = list.filter(p => !result.has(p.id) || result.get(p.id).problems.length);
  let fixed = 0;
  if (failing.length) {
    try {
      const fix = failing.map(p => ({ id: p.id, name: p.name, problems: result.has(p.id) ? result.get(p.id).problems : ['No draft was returned.'], previous: result.has(p.id) ? { connectionNote: result.get(p.id).connectionNote, followUp: result.get(p.id).followUp } : null }));
      const again = await write(failing, seller, { ...opts, fix });
      again.forEach(d => { const c = check(d); if (c) { if (!c.problems.length) fixed++; result.set(c.id, c); } });
    } catch { /* the first drafts and their problems stand */ }
  }

  return {
    drafts: list.map(p => {
      const c = result.get(p.id);
      return {
        id: p.id, name: p.name, title: p.title || '', company: p.company || '', linkedinUrl: p.linkedinUrl || '',
        connectionNote: c ? c.connectionNote : '', followUp: c ? c.followUp : '',
        problems: c ? c.problems : ['No draft was written.'], usable: !!c && c.problems.length === 0,
      };
    }),
    rewrittenOk: fixed,
  };
}

module.exports = { buildDrafts, problemsWith, NOTE_LIMIT, FOLLOWUP_LIMIT, MAX_PROSPECTS, TOOL, SYSTEM_PROMPT };
