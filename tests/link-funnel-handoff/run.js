/**
 * LinkFunnelHandoff is what lets a Link Funnel report's URLs actually reach
 * another agent's existing action, following the same "small localStorage
 * payload per destination" shape PatHandoff already established.
 *
 * What this pins:
 *
 *   Step-through targets (Nancy, SEO Express, SEO AI Citation, Social
 *   Research) each front a real paid/slow external call, so the queue only
 *   ever advances one URL at a time, on an explicit advance() — never all at
 *   once. clear() removes the queue entirely rather than leaving a stale
 *   index 0 payload sitting in localStorage for next visit.
 *
 *   advance() past the last URL clears the queue automatically, so a
 *   destination page doesn't need to special-case "index === length" itself.
 *
 *   send() with an empty URL list refuses outright rather than silently
 *   queuing nothing.
 *
 *   node tests/link-funnel-handoff/run.js
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
  const fakeLocation = { href: '' };
  const fakeWindow = {
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => { store.set(k, String(v)); },
      removeItem: (k) => { store.delete(k); },
    },
    location: fakeLocation,
    open: () => null,
  };
  const src = fs.readFileSync(path.join(REPO, 'web/js/link-funnel-handoff.js'), 'utf8');
  const fn = new Function('window', 'localStorage', `${src}\nreturn window.LinkFunnelHandoff;`);
  const mod = fn(fakeWindow, fakeWindow.localStorage);
  return { mod, fakeWindow, store };
}

console.log('\n──── every wired destination has a real, distinct localStorage key ────');
{
  const { mod } = loadModule();
  const keys = Object.keys(mod.TARGETS).map(k => mod.TARGETS[k].key);
  check('5 destinations are registered', Object.keys(mod.TARGETS).length === 5);
  check('every destination has its own key (no collisions)', new Set(keys).size === keys.length);
  check('Blade is deliberately NOT a target (no manual-entry field to seed)', !('blade' in mod.TARGETS));
}

console.log('\n──── step-through targets advance one URL at a time ────');
{
  const { mod } = loadModule();
  mod.send('nancy', ['https://a.com', 'https://b.com', 'https://c.com'], { reportName: 'Q3 leads' });
  let q = mod.peek('nancy');
  check('the queue starts at index 0', q.index === 0 && q.urls[q.index] === 'https://a.com');
  check('the report name is carried through', q.reportName === 'Q3 leads');

  q = mod.advance('nancy');
  check('advancing moves to the next URL, not all of them', q.index === 1 && q.urls[q.index] === 'https://b.com');

  q = mod.advance('nancy');
  check('a second advance moves to the last URL', q.index === 2 && q.urls[q.index] === 'https://c.com');

  q = mod.advance('nancy');
  check('advancing past the last URL clears the queue entirely, not just past the end', q === null && mod.peek('nancy') === null);
}

console.log('\n──── clear() removes a queue outright ────');
{
  const { mod } = loadModule();
  mod.send('social-research', ['https://example.com']);
  check('the queue exists before clearing', mod.peek('social-research') !== null);
  mod.clear('social-research');
  check('nothing is left after clearing', mod.peek('social-research') === null);
}

console.log('\n──── separate destinations don\'t stomp on each other\'s queues ────');
{
  const { mod } = loadModule();
  mod.send('seo-express', ['https://express.example']);
  mod.send('seo-citation', ['https://citation.example']);
  check('seo-express keeps its own queue', mod.peek('seo-express').urls[0] === 'https://express.example');
  check('seo-citation keeps its own, independent queue', mod.peek('seo-citation').urls[0] === 'https://citation.example');
}

console.log('\n──── sending nothing is refused, not silently queued ────');
{
  const { mod } = loadModule();
  let threw = false;
  try { mod.send('nancy', []); } catch (e) { threw = true; }
  check('an empty URL list throws rather than queuing an empty run', threw);
  check('nothing was actually written', mod.peek('nancy') === null);
}

console.log('\n──── bulk-import targets carry the whole list for one confirmation, not a step-through ────');
{
  const { mod } = loadModule();
  mod.send('competitive-watch', ['https://one.com', 'https://two.com', 'https://three.com'], { reportName: 'Competitors' });
  const q = mod.peek('competitive-watch');
  check('the destination sees the full batch at once', q.urls.length === 3);
  check('the module records this as a bulk-mode target', mod.TARGETS['competitive-watch'].mode === 'bulk');
  check('step-through targets are marked distinctly', mod.TARGETS['nancy'].mode === 'step');
}

console.log(failures === 0 ? '\nALL ASSERTIONS PASSED\n' : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
