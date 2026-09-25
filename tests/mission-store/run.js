/**
 * MissionStore.updateStep() matched steps by agentKey alone, so a mission
 * plan that selects the same agent for two separate tasks (nothing stops
 * the planner from doing this — see scotty-orchestrator.js's agentKeys
 * selection, no uniqueness constraint) had its second task's progress
 * updates land on the first task's already-finished step instead. Both
 * tasks actually ran and rendered correctly in Scotty's own chat panel,
 * but the shared mission bar shown on every other agent page during the
 * mission silently showed the wrong (or missing) status for one of them.
 *
 * scotty.html's execution loop is strictly sequential (one `await` per
 * task — see its `for` loop), so the fix scopes the match to the earliest
 * not-yet-finished step for that agent key, which is always the one
 * actually being worked on right now.
 *
 *   node tests/mission-store/run.js
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

function loadModule() {
  const store = new Map();
  const fakeWindow = {
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => { store.set(k, String(v)); },
      removeItem: (k) => { store.delete(k); },
    },
  };
  const src = fs.readFileSync(path.join(REPO, 'web/js/mission-store.js'), 'utf8');
  const fn = new Function('window', 'localStorage', `${src}\nreturn window.MissionStore;`);
  return fn(fakeWindow, fakeWindow.localStorage);
}

console.log('\n──── two tasks assigned to the SAME agent get independently tracked steps ────');
{
  const MissionStore = loadModule();
  const mission = MissionStore.create('Grow email list', [
    { agentKey: 'email', taskName: 'Draft welcome sequence', objective: 'x' },
    { agentKey: 'seo', taskName: 'Audit landing page', objective: 'y' },
    { agentKey: 'email', taskName: 'Draft nurture sequence', objective: 'z' },
  ]);

  // Sequential execution, exactly like scotty.html's real loop: task 0 runs
  // to completion before task 1 starts, task 1 before task 2, etc.
  MissionStore.updateStep(mission.id, 'email', { status: 'in_progress' });
  MissionStore.updateStep(mission.id, 'email', { status: 'done', resultSummary: 'Welcome sequence drafted' });
  MissionStore.updateStep(mission.id, 'seo', { status: 'in_progress' });
  MissionStore.updateStep(mission.id, 'seo', { status: 'done', resultSummary: 'Landing page audited' });
  MissionStore.updateStep(mission.id, 'email', { status: 'in_progress' });
  const final = MissionStore.updateStep(mission.id, 'email', { status: 'done', resultSummary: 'Nurture sequence drafted' });

  const emailSteps = final.steps.filter(s => s.agentKey === 'email');
  check('both email tasks exist as separate steps', emailSteps.length === 2);
  check('the FIRST email task is marked done with its own real result', emailSteps[0].status === 'done' && emailSteps[0].resultSummary === 'Welcome sequence drafted');
  check('the SECOND email task is ALSO marked done, with its own distinct result — not lost', emailSteps[1].status === 'done' && emailSteps[1].resultSummary === 'Nurture sequence drafted');
  check('the seo task in between is unaffected', final.steps.find(s => s.agentKey === 'seo').status === 'done');
  check('every step in the mission is done — none silently left pending', final.steps.every(s => s.status === 'done'));
}

console.log('\n──── a failed task in a repeated-agent pair does not block the next one from tracking correctly ────');
{
  const MissionStore = loadModule();
  const mission = MissionStore.create('Two social tasks', [
    { agentKey: 'social', taskName: 'Post A', objective: 'a' },
    { agentKey: 'social', taskName: 'Post B', objective: 'b' },
  ]);
  MissionStore.updateStep(mission.id, 'social', { status: 'in_progress' });
  MissionStore.updateStep(mission.id, 'social', { status: 'skipped', resultSummary: 'Failed after retry.' });
  MissionStore.updateStep(mission.id, 'social', { status: 'in_progress' });
  const final = MissionStore.updateStep(mission.id, 'social', { status: 'done', resultSummary: 'Post B succeeded' });

  const steps = final.steps;
  check('the first (failed) task stays skipped, not overwritten by the second', steps[0].status === 'skipped');
  check('the second task is tracked as its own done step', steps[1].status === 'done' && steps[1].resultSummary === 'Post B succeeded');
}

console.log('\n──── the ordinary case (no repeated agent) still works exactly as before ────');
{
  const MissionStore = loadModule();
  const mission = MissionStore.create('Normal mission', [
    { agentKey: 'sales', taskName: 'Find leads', objective: 'x' },
    { agentKey: 'email', taskName: 'Draft outreach', objective: 'y' },
  ]);
  MissionStore.updateStep(mission.id, 'sales', { status: 'done', resultSummary: 'Found 12 leads' });
  const final = MissionStore.updateStep(mission.id, 'email', { status: 'in_progress' });
  check('unrelated single-occurrence steps update normally', final.steps[0].status === 'done' && final.steps[1].status === 'in_progress');
}

console.log(failures === 0 ? '\nALL ASSERTIONS PASSED\n' : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
