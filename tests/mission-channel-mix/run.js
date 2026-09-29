/**
 * Scotty's mission plan now also asks Claude for a "channelMix" — a
 * strategist's judgment on which channels/formats are worth leaning into
 * this week (inspired by a competitor's "Short-form video 86%, Carousels
 * 54%" weekly-focus display), attached alongside the existing
 * missionTitle/missionSummary/agentKeys/tasks output of
 * generateMissionPlan() in web/js/scotty-orchestrator.js.
 *
 * This is a judgment call, not measured analytics — nothing in this app is
 * allowed to present an AI opinion as if it were real performance data (the
 * running rule behind every "Synthetic" / "not measured" label already in
 * this codebase). So this test pins two things at once: the field reaches
 * the caller correctly-shaped, AND it survives being handed garbage from the
 * model without ever fabricating structure that wasn't there.
 *
 *   node tests/mission-channel-mix/run.js
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
const fakeDocument = { readyState: 'complete', querySelectorAll: () => [], addEventListener: () => {} };

function loadOrchestrator(claudeResponses) {
  let call = 0;
  const fakeWindow = {
    ClaudeService: {
      streamResponse: async () => {
        const resp = claudeResponses[Math.min(call, claudeResponses.length - 1)];
        call++;
        return resp;
      },
    },
  };
  const fn = new Function('window', 'document', `${src}\nreturn window.ScottyOrchestrator;`);
  return fn(fakeWindow, fakeDocument);
}

const TASK_JSON = JSON.stringify({
  taskName: 'Write nurture sequence',
  objective: 'Warm up the list',
  userPrompt: 'Write a 3-email nurture sequence for this audience.',
});

console.log('\n──── channelMix reaches the caller, sanitized ────');
(async () => {
  const selection = JSON.stringify({
    missionTitle: 'Launch nurture campaign',
    missionSummary: 'Warm leads with a targeted email sequence.',
    agentKeys: ['email'],
    channelMix: [
      { channel: 'Email sequence', focus: 92 },
      { channel: 'Short-form video', focus: 61.7 },
    ],
  });
  const Orchestrator = loadOrchestrator([selection, TASK_JSON]);
  const plan = await Orchestrator.generateMissionPlan('Warm up cold leads', null, () => {});

  check('channelMix is present on the returned plan', Array.isArray(plan.channelMix));
  check('both channels came through', plan.channelMix.length === 2);
  check('channel names are preserved', plan.channelMix[0].channel === 'Email sequence');
  check('focus scores are rounded to whole numbers', plan.channelMix[1].focus === 62);
  check('the existing fields are untouched by the new one',
    plan.missionTitle === 'Launch nurture campaign' && plan.tasks.length === 1);

  console.log('\n──── entries scoring don\'t need to sum to 100 — independent, not a pie chart ────');
  const total = plan.channelMix.reduce((sum, c) => sum + c.focus, 0);
  check('two channels can both score high without being normalised down', total > 100);

  console.log('\n──── malformed or missing channelMix never breaks the plan, never fabricates one ────');

  const noMixSelection = JSON.stringify({
    missionTitle: 'SEO refresh',
    missionSummary: 'Audit and refresh top pages.',
    agentKeys: ['seo'],
  });
  const Orchestrator2 = loadOrchestrator([noMixSelection, TASK_JSON]);
  const plan2 = await Orchestrator2.generateMissionPlan('Refresh SEO', null, () => {});
  check('omitted channelMix defaults to an empty array, not undefined or a guess',
    Array.isArray(plan2.channelMix) && plan2.channelMix.length === 0);

  const junkSelection = JSON.stringify({
    missionTitle: 'Content push',
    missionSummary: 'Ship more content.',
    agentKeys: ['content'],
    channelMix: [
      { channel: '', focus: 50 },           // blank name — dropped
      { channel: 'Blog', focus: 'high' },   // non-numeric focus — dropped
      { channel: 'Podcast', focus: 150 },   // out of range — clamped
      { channel: 'Newsletter', focus: -20 },// out of range — clamped
      { channel: 42, focus: 30 },           // non-string channel — dropped
      'not even an object',                 // dropped
    ],
  });
  const Orchestrator3 = loadOrchestrator([junkSelection, TASK_JSON]);
  const plan3 = await Orchestrator3.generateMissionPlan('Ship content', null, () => {});
  check('only the two structurally valid entries survive', plan3.channelMix.length === 2);
  check('out-of-range focus scores are clamped to 0-100, not trusted as-is',
    plan3.channelMix.find(c => c.channel === 'Podcast').focus === 100 &&
    plan3.channelMix.find(c => c.channel === 'Newsletter').focus === 0);

  console.log('\n──── an oversized channel name is truncated, not left to overflow the UI ────');
  const longNameSelection = JSON.stringify({
    missionTitle: 'X', missionSummary: 'Y', agentKeys: ['ads'],
    channelMix: [{ channel: 'A'.repeat(200), focus: 50 }],
  });
  const Orchestrator4 = loadOrchestrator([longNameSelection, TASK_JSON]);
  const plan4 = await Orchestrator4.generateMissionPlan('Run ads', null, () => {});
  check('channel name is capped at 40 characters', plan4.channelMix[0].channel.length === 40);

  console.log('\n──── the mission plan\'s own JSON schema documents this as judgment, not measurement ────');
  check('the prompt tells the model these are not shares of a pie / not analytics',
    /not shares of a pie/i.test(src) && /not a measurement/i.test(src));

  console.log(failures === 0 ? '\nALL ASSERTIONS PASSED\n' : `\n${failures} FAILED\n`);
  process.exit(failures === 0 ? 0 : 1);
})();
