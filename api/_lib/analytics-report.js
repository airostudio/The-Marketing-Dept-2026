/**
 * api/_lib/analytics-report.js — write a marketing performance report from a
 * facts bundle (api/_lib/analytics-facts.js) and refuse to pass it unless every
 * figure in it came from those facts.
 *
 * The model is handed only the facts and told to quote them, never compute a
 * new figure, never invent a benchmark, and to say plainly when a source is
 * unavailable or not recorded. Then the text is checked by code: any number
 * not found in the facts is listed, the model gets ONE chance to remove or
 * replace them, and a report that still contains an unsupported figure is
 * returned as not approved — it cannot be approved, only rejected or re-run.
 */

'use strict';

const { callClaudeForJSON } = require('./nancy-claude.js');
const { verifyNumbers } = require('./analytics-facts.js');
const { directive: languageDirective } = require('./writing-language.js');

const REPORT_TOOL = {
  name: 'submit_performance_report',
  description: 'Submit the finished marketing performance report.',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Plain report title naming the period, under 90 characters.' },
      summary: { type: 'string', description: 'A 3-5 sentence executive summary of what the data shows. Only figures from the facts.' },
      sections: {
        type: 'array', minItems: 1, maxItems: 6,
        items: {
          type: 'object',
          properties: {
            heading: { type: 'string' },
            body: { type: 'string', description: 'Markdown. Quote figures exactly as given in the facts. Say when a source is unavailable or not recorded.' },
          },
          required: ['heading', 'body'],
        },
      },
      recommendations: { type: 'array', minItems: 1, maxItems: 5, items: { type: 'string', description: 'A concrete action, tied to something specific in the facts.' } },
    },
    required: ['title', 'summary', 'sections', 'recommendations'],
  },
};

const SYSTEM_PROMPT = `You write a marketing performance report for a small business owner from a FACTS bundle taken from their own account. Plain, direct, no hype.

Hard rules — each exists because breaking it puts a false number in front of someone making decisions:
- Use ONLY figures that appear in FACTS. Quote them exactly (you may write 1234 as 1,234 or 12.5 as 12.5%). Never calculate a new figure: no sums, differences, averages or ratios of your own. Where FACTS give a change (…ChangePct) quote that; where they don't, describe the direction in words with no number.
- Never state an industry benchmark, average, "typical" rate or target. FACTS contain none; you have no source for one.
- A null rate, or a section marked available:false or not recorded, means NOT MEASURED. Say that plainly and say why if FACTS do. Never present it as zero, as "nobody", or as poor performance.
- Do not explain causes you cannot see. "Opens rose" is a fact; "because of the new subject line" is a guess.
- Social: FACTS count what was posted, not how it performed. Do not discuss reach, likes or engagement.
- Recommendations must be actions the owner can take, each tied to a specific fact (including to a gap such as "open tracking is not recorded").
- If the period had little or no activity, say so briefly rather than padding.`;

function compose(r) {
  const parts = [`# ${r.title}`, '', r.summary, ''];
  (r.sections || []).forEach(s => { parts.push(`## ${s.heading}`, '', s.body, ''); });
  parts.push('## Recommendations', '', ...(r.recommendations || []).map(x => `- ${x}`));
  return parts.join('\n');
}

async function writeOnce(facts, { focus, language, businessContext, fixList, previous }) {
  const user = [
    `FACTS (JSON):\n${JSON.stringify(facts, null, 2)}`,
    focus ? `\nThe owner asked the report to focus on: ${focus}` : '',
    businessContext ? `\nBackground on the business (framing only — do not take figures from it):\n${String(businessContext).slice(0, 1500)}` : '',
    fixList && fixList.length ? `\nYOUR PREVIOUS DRAFT contained figures that are NOT in FACTS: ${fixList.join(', ')}. Rewrite the report so every figure comes from FACTS — remove or replace those, do not substitute other invented ones.\nPrevious draft:\n${previous}` : '',
  ].filter(Boolean).join('\n');
  const r = await callClaudeForJSON({
    system: SYSTEM_PROMPT + (languageDirective(language) ? '\n\n' + languageDirective(language) : ''),
    user, tool: REPORT_TOOL, maxTokens: 3500, timeoutMs: 55000,
  });
  if (!r.success) throw new Error(r.error);
  return r.data;
}

/**
 * @returns {Promise<{title:string, markdown:string, review:{approved:boolean, unsupportedNumbers:string[], fixed:boolean}}>}
 */
async function buildReport(facts, opts = {}, deps = {}) {
  const write = deps.write || writeOnce;
  let data = await write(facts, opts);
  let markdown = compose(data);
  let unsupported = verifyNumbers(markdown, facts);
  let fixed = false;
  if (unsupported.length) {
    try {
      data = await write(facts, { ...opts, fixList: unsupported, previous: markdown });
      markdown = compose(data);
      unsupported = verifyNumbers(markdown, facts);
      fixed = true;
    } catch { /* the first draft and its unsupported figures stand, and block approval */ }
  }
  return { title: String(data.title || 'Marketing performance report').slice(0, 120), markdown, review: { approved: unsupported.length === 0, unsupportedNumbers: unsupported, fixed } };
}

module.exports = { buildReport, compose, REPORT_TOOL, SYSTEM_PROMPT };
