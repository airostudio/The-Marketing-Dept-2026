/**
 * Scotty's mission/automation planning asks Claude to "respond ONLY with
 * valid JSON", then trusts it and calls JSON.parse directly. Claude is not a
 * JSON serializer: a raw newline left un-escaped inside a "description"
 * string is enough to break it, and the customer saw the raw V8 message
 * verbatim — "Could not generate automation plan: JSON.parse: expected
 * double-quoted property name at line 14 column 35 of the JSON data" — with
 * no way to recover except restarting the whole mission.
 *
 * parseJsonLoose() repairs the mechanical, common breakages (trailing
 * commas, un-escaped control characters inside strings) without inventing
 * content, and callJsonPrompt() retries the underlying request once before
 * giving up. This exercises both against the exact shapes of malformed JSON
 * a model actually produces, loading web/js/scotty-orchestrator.js as a real
 * browser global the same way the rest of this suite fakes `window`.
 *
 *   node tests/scotty-json-repair/run.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..');
let failures = 0;
function check(label, ok) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failures++;
}

const src = fs.readFileSync(path.join(REPO, 'web/js/scotty-orchestrator.js'), 'utf8');
const fakeDocument = {
  readyState: 'complete',
  querySelectorAll: () => [],
  addEventListener: () => {},
};
function loadOrchestrator(win) {
  const fn = new Function('window', 'document', `${src}\nreturn window.ScottyOrchestrator;`);
  return fn(win, fakeDocument);
}
const Orchestrator = loadOrchestrator({});

console.log('\n──── parseJsonLoose: well-formed JSON still parses normally ────');
{
  const good = '{"assessment":"fine","automations":[{"id":"a1"}]}';
  const parsed = Orchestrator.parseJsonLoose(good, 'test');
  check('parses valid JSON unchanged', parsed.assessment === 'fine' && parsed.automations.length === 1);
}

console.log('\n──── parseJsonLoose: trailing commas are repaired ────');
{
  const trailingComma = `{
  "assessment": "ok",
  "automations": [
    { "id": "a1", "title": "One" },
    { "id": "a2", "title": "Two" },
  ]
}`;
  const parsed = Orchestrator.parseJsonLoose(trailingComma, 'test');
  check('repairs a trailing comma before ]', Array.isArray(parsed.automations) && parsed.automations.length === 2);
}

console.log('\n──── parseJsonLoose: the exact reported failure — a raw newline inside a string ────');
{
  // Reproduces "expected double-quoted property name at line 14 column 35":
  // the model wrote a real linebreak inside "description" instead of \n,
  // which ends the string early and turns the next line into what looks
  // like an unquoted property name.
  const rawNewlineInString = [
    '{',
    '  "assessment": "Agents completed strong analysis.",',
    '  "automations": [',
    '    {',
    '      "id": "auto_email_seq",',
    '      "agentKey": "email",',
    '      "title": "Build 5-Email Lead Nurture Sequence",',
    '      "description": "Ready-to-deploy email copy based on',
    '  the ICP and competitive analysis just completed",',
    '      "impact": "High",',
    '      "timeEstimate": "~2 min",',
    '      "deliverable": "5 complete email templates"',
    '    }',
    '  ]',
    '}',
  ].join('\n');

  let threwNatively = false;
  try { JSON.parse(rawNewlineInString.match(/\{[\s\S]*\}/)[0]); } catch (e) { threwNatively = true; }
  check('sanity: this text genuinely fails plain JSON.parse (reproduces the report)', threwNatively);

  const parsed = Orchestrator.parseJsonLoose(rawNewlineInString, 'Automation assessment');
  check('parseJsonLoose recovers it anyway', Array.isArray(parsed.automations) && parsed.automations.length === 1);
  check('the repaired description still contains both halves of the sentence',
    /based on/.test(parsed.automations[0].description) && /ICP and competitive/.test(parsed.automations[0].description));
}

console.log('\n──── parseJsonLoose: genuinely unrecoverable JSON throws a diagnosable error, not a dead end ────');
{
  const trulyBroken = '{ "assessment": "ok" "automations": [}';
  let caught = null;
  try { Orchestrator.parseJsonLoose(trulyBroken, 'Automation assessment'); }
  catch (e) { caught = e; }
  check('throws rather than returning something silently wrong', !!caught);
  check('the error names the label, not just a generic message', caught && /Automation assessment/.test(caught.message));
  check('the error carries a snippet of the raw text for diagnosis', caught && typeof caught.rawText === 'string' && caught.rawText.length > 0);
}

console.log('\n──── parseJsonLoose: no JSON object at all ────');
{
  let caught = null;
  try { Orchestrator.parseJsonLoose('Sorry, I cannot help with that.', 'Mission plan selection'); }
  catch (e) { caught = e; }
  check('throws a clear "no JSON object found" error', caught && /no JSON object found/.test(caught.message));
}

console.log('\n──── callJsonPrompt: retries once on a malformed first response ────');
(async () => {
  let calls = 0;
  const fakeClaudeService = {
    streamResponse: async () => {
      calls++;
      if (calls === 1) return '{"ok": true "unrepairable": missing a comma here}';
      return '{"ok": true}';
    },
  };
  const Orchestrator2 = loadOrchestrator({ ClaudeService: fakeClaudeService });

  const result = await Orchestrator2.callJsonPrompt({ systemPrompt: 'x', messages: [] }, 'test prompt');
  check('recovered on the second attempt', result.ok === true);
  check('it actually retried (made two calls)', calls === 2);

  let calls2 = 0;
  const alwaysBroken = {
    streamResponse: async () => { calls2++; return 'not json at all, no braces here'; },
  };
  const Orchestrator3 = loadOrchestrator({ ClaudeService: alwaysBroken });

  let caught = null;
  try { await Orchestrator3.callJsonPrompt({ systemPrompt: 'x', messages: [] }, 'Automation assessment'); }
  catch (e) { caught = e; }
  check('gives up cleanly after the retry is also broken (bounded, not infinite)', calls2 === 2);
  check('the final error is still diagnosable', caught && /Automation assessment/.test(caught.message));

  console.log(failures === 0 ? '\nALL ASSERTIONS PASSED\n' : `\n${failures} FAILED\n`);
  process.exit(failures === 0 ? 0 : 1);
})();
