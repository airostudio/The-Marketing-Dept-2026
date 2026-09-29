/**
 * The Load Testing Agent dashboard used to show only a handful of stat tiles
 * that silently redrew every poll — "it starts, but nothing actually
 * happens" was a real, reasonable read of that UI even when the simulation
 * was progressing normally, and the only way to tell the difference from a
 * genuinely stuck run (see tests/load-testing/run.js's stale-tick coverage)
 * was to stare at whether a number had changed since the last glance.
 *
 * web/tools/load-testing.html now builds a live, scrolling activity log by
 * diffing consecutive snapshot rows client-side — no new endpoint, just
 * arithmetic over what /api/loadtest-status already returns. This pins that
 * diffing logic directly, loading the page's real inline script the same
 * way tests/scotty-json-repair/run.js loads a browser global: as actual
 * source, run against a minimal fake DOM, not a re-implementation of the
 * logic under test.
 *
 *   node tests/load-testing-activity/run.js
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

const html = fs.readFileSync(path.join(REPO, 'web/tools/load-testing.html'), 'utf8');
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
if (!scriptMatch) throw new Error('Could not find the inline <script> in load-testing.html');
const src = scriptMatch[1];

/* ── A minimal, auto-vivifying fake DOM ──────────────────────────────────
 * The real script touches dozens of elements (the password gate, the config
 * form, chart canvases) that this test does not exercise. Rather than hand-
 * build all of them, every id resolves to a generic stub that accepts any
 * property/method call as a no-op — real behavior is layered on top only
 * for the three elements the activity log actually renders into. */
function makeGenericElement(id) {
  const el = {
    id,
    style: {},
    classList: { add() {}, remove() {}, toggle() {} },
    dataset: {},
    children: [],
    value: '',
    textContent: '',
    checked: false,
    disabled: false,
    addEventListener() {},
    appendChild(child) { el.children.push(child); return child; },
    removeChild(child) {
      const i = el.children.indexOf(child);
      if (i >= 0) el.children.splice(i, 1);
      return child;
    },
    querySelector() { return makeGenericElement(id + '__q'); },
    querySelectorAll() { return []; },
    closest() { return makeGenericElement(id + '__closest'); },
    scrollTop: 0,
  };
  Object.defineProperty(el, 'scrollHeight', { get: () => el.children.length });
  Object.defineProperty(el, 'firstChild', { get: () => el.children[0] });
  let innerHTMLValue = '';
  Object.defineProperty(el, 'innerHTML', {
    get: () => innerHTMLValue,
    set: (v) => { innerHTMLValue = v; if (v === '') el.children.length = 0; },
  });
  return el;
}

function makeFakeDocument() {
  const cache = {};
  return {
    getElementById(id) { return cache[id] || (cache[id] = makeGenericElement(id)); },
    createElement() {
      const node = { className: '', textContent: '' };
      return node;
    },
    addEventListener() {},
    _cache: cache,
  };
}

function loadPageFunctions() {
  const fakeDocument = makeFakeDocument();
  const fakeWindow = {};
  global.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  global.fetch = async () => { throw new Error('this test never expects a real fetch'); };
  const fn = new Function('window', 'document', `${src}
return { appendActivityFromSnapshots, resetActivityLogIfNewRun, ACTIVITY_STATE, fmtNum };`);
  const exported = fn(fakeWindow, fakeDocument);
  return { exported, fakeDocument };
}

function snapshot(overrides) {
  return Object.assign({
    snapshot_at: new Date().toISOString(),
    concurrent_vus: 0,
    concurrent_builds: 0,
    queue_depth: 0,
    jobs_requested_total: 0,
    jobs_succeeded_total: 0,
    jobs_failed_total: 0,
  }, overrides);
}

console.log('\n──── no snapshots yet: an honest waiting message, not silence ────');
{
  const { exported, fakeDocument } = loadPageFunctions();
  const run = { id: 'run-1', status: 'running' };
  exported.appendActivityFromSnapshots(run, []);
  const log = fakeDocument.getElementById('activity-log');
  check('exactly one line is shown', log.children.length === 1);
  check('it says it is waiting for the first tick', /waiting for the first tick/i.test(log.children[0].textContent));
  check('the line is styled muted, not as a warning', log.children[0].className.includes('muted'));
}

console.log('\n──── the first render seeds from current state only, not the whole history replayed ────');
{
  const { exported, fakeDocument } = loadPageFunctions();
  const run = { id: 'run-2', status: 'running' };
  const t0 = Date.now();
  const snaps = [
    snapshot({ snapshot_at: new Date(t0).toISOString(), jobs_requested_total: 10, jobs_succeeded_total: 9, jobs_failed_total: 1 }),
    snapshot({ snapshot_at: new Date(t0 + 60000).toISOString(), jobs_requested_total: 40, jobs_succeeded_total: 38, jobs_failed_total: 2, concurrent_vus: 12, concurrent_builds: 5, queue_depth: 3 }),
    snapshot({ snapshot_at: new Date(t0 + 120000).toISOString(), jobs_requested_total: 90, jobs_succeeded_total: 85, jobs_failed_total: 3, concurrent_vus: 20, concurrent_builds: 8, queue_depth: 1 }),
  ];
  exported.appendActivityFromSnapshots(run, snaps);
  const log = fakeDocument.getElementById('activity-log');
  check('only ONE line is logged on first render, not three', log.children.length === 1);
  const line = log.children[0].textContent;
  check('the delta is computed against the PREVIOUS snapshot, not from zero',
    line.includes('+50 requested') && line.includes('+47 succeeded') && line.includes('+1 failed'));
  check('concurrency figures from the latest snapshot are shown', line.includes('20') && line.includes('8') && /queue 1\b/.test(line));
}

console.log('\n──── a later poll with one new snapshot appends exactly one new line ────');
{
  const { exported, fakeDocument } = loadPageFunctions();
  const run = { id: 'run-3', status: 'running' };
  const t0 = Date.now();
  const first = [snapshot({ snapshot_at: new Date(t0).toISOString(), jobs_requested_total: 10, jobs_succeeded_total: 10, jobs_failed_total: 0 })];
  exported.appendActivityFromSnapshots(run, first);
  const log = fakeDocument.getElementById('activity-log');
  check('one line after the first poll', log.children.length === 1);

  // Same array again — nothing new happened since the last poll.
  exported.appendActivityFromSnapshots(run, first);
  check('polling again with no new snapshot appends nothing', log.children.length === 1);

  const second = first.concat([
    snapshot({ snapshot_at: new Date(t0 + 60000).toISOString(), jobs_requested_total: 25, jobs_succeeded_total: 24, jobs_failed_total: 1 }),
  ]);
  exported.appendActivityFromSnapshots(run, second);
  check('exactly one new line appended for the one new snapshot', log.children.length === 2);
  const newLine = log.children[1].textContent;
  check('its delta is against the running state, not recomputed from the array start',
    newLine.includes('+15 requested') && newLine.includes('+14 succeeded') && newLine.includes('+1 failed'));
  check('a tick with a failure is styled as a warning', log.children[1].className.includes('warn'));
}

console.log('\n──── an idle tick (no new jobs) reads as idle, not omitted ────');
{
  const { exported, fakeDocument } = loadPageFunctions();
  const run = { id: 'run-4', status: 'running' };
  const t0 = Date.now();
  const first = [snapshot({ snapshot_at: new Date(t0).toISOString(), jobs_requested_total: 5, jobs_succeeded_total: 5, jobs_failed_total: 0 })];
  exported.appendActivityFromSnapshots(run, first);
  const second = first.concat([
    snapshot({ snapshot_at: new Date(t0 + 60000).toISOString(), jobs_requested_total: 5, jobs_succeeded_total: 5, jobs_failed_total: 0, concurrent_vus: 3 }),
  ]);
  exported.appendActivityFromSnapshots(run, second);
  const log = fakeDocument.getElementById('activity-log');
  check('the idle tick still produces a line', log.children.length === 2);
  check('and says so explicitly', /idle tick/i.test(log.children[1].textContent));
}

console.log('\n──── switching to a different run resets the log instead of mixing histories ────');
{
  const { exported, fakeDocument } = loadPageFunctions();
  const runA = { id: 'run-a', status: 'running' };
  const runB = { id: 'run-b', status: 'running' };
  exported.appendActivityFromSnapshots(runA, [snapshot({ jobs_requested_total: 100, jobs_succeeded_total: 90, jobs_failed_total: 10 })]);
  const log = fakeDocument.getElementById('activity-log');
  check('run A logged its line', log.children.length === 1);

  exported.appendActivityFromSnapshots(runB, [snapshot({ jobs_requested_total: 2, jobs_succeeded_total: 2, jobs_failed_total: 0 })]);
  check('switching runs clears the previous run\'s lines', log.children.length === 1);
  check('the ACTIVITY_STATE now tracks the new run id', exported.ACTIVITY_STATE.runId === 'run-b');
}

console.log('\n──── the line cap keeps the log bounded on a long-running test ────');
{
  const { exported, fakeDocument } = loadPageFunctions();
  const run = { id: 'run-long', status: 'running' };
  const t0 = Date.now();
  let snaps = [snapshot({ snapshot_at: new Date(t0).toISOString() })];
  exported.appendActivityFromSnapshots(run, snaps);
  for (let i = 1; i <= 250; i++) {
    snaps = snaps.concat([snapshot({ snapshot_at: new Date(t0 + i * 60000).toISOString(), jobs_requested_total: i, jobs_succeeded_total: i })]);
    exported.appendActivityFromSnapshots(run, snaps);
  }
  const log = fakeDocument.getElementById('activity-log');
  check('the log never grows past the configured cap', log.children.length <= 200);
}

console.log(failures === 0 ? '\nALL ASSERTIONS PASSED\n' : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
