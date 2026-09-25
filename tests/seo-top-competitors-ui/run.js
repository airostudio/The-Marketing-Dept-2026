/**
 * web/seo/keywords.html — "Who's Ranking #1-3" column.
 *
 * "Where should we be ranking" only has an honest answer if it names who
 * actually holds those spots today (real domains from the same live SERP
 * call), rather than inventing a predicted target position — the same class
 * of fabrication already found and removed from this page (SEO #1-4 this
 * session: fabricated PageSpeed score, null-counted-as-Top-3, word-count-as-
 * difficulty, dead Refresh Rankings button). This pins the rendering side:
 * the connector/store changes are covered by tests/seo-intelligence/run.js.
 *
 *   node tests/seo-top-competitors-ui/run.js
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

const html = fs.readFileSync(path.join(REPO, 'web/seo/keywords.html'), 'utf8');
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
if (!scriptMatch) throw new Error('Could not find the inline <script> in keywords.html');
const src = scriptMatch[1];

function makeGenericElement(id, registry) {
  const el = {
    _id: id, style: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    dataset: {}, children: [], value: '', textContent: '',
    addEventListener() {},
    appendChild(child) { el.children.push(child); return child; },
    querySelector: () => makeGenericElement(id + '__q', registry),
    querySelectorAll: () => [],
  };
  Object.defineProperty(el, 'innerHTML', { get: () => el._html || '', set: (v) => { el._html = v; } });
  // A <tr> created via document.createElement only gets a real id assigned
  // AFTER creation (detailRow.id = `top3-detail-${kw.id}`) — this registers
  // it into the shared lookup at that point, so a later
  // document.getElementById() call (from toggleTopCompetitors) finds the
  // actual rendered element instead of fabricating a disconnected stand-in.
  Object.defineProperty(el, 'id', {
    get: () => el._id,
    set: (v) => { el._id = v; if (registry) registry[v] = el; },
  });
  return el;
}

function loadModule() {
  const cache = {};
  const fakeDocument = {
    getElementById: (id) => cache[id] || (cache[id] = makeGenericElement(id, cache)),
    createElement: (tag) => makeGenericElement('created-' + tag, cache),
    addEventListener() {},
    querySelectorAll: () => [],
  };
  const fakeWindow = {
    KeywordService: {
      KeywordTracker: {
        estimateTrafficFromPosition: (position, volume) => (position && volume ? volume * 0.1 : 0),
      },
    },
  };
  // The real script is `(function() { 'use strict'; ... })();` — strip the
  // outer IIFE wrapper so the functions we need become locals we can return
  // directly, the same technique tests/brand-health-trend/run.js uses for
  // brand.html's identically-shaped inline script.
  let body = src.replace(/^\s*\(function\s*\(\)\s*\{\s*'use strict';/, '');
  body = body.replace(/\}\s*\)\s*\(\);\s*$/, '');
  const fn = new Function('window', 'document', `${body}
return { renderKeywordsTable, toggleTopCompetitors };`);
  const mod = fn(fakeWindow, fakeDocument);
  return { mod, cache };
}

function baseKeyword(overrides) {
  return Object.assign({
    id: 'kw1', keyword: 'blue widgets', position: null, previousPosition: null,
    searchVolume: 1000, difficulty: null, intent: 'commercial',
  }, overrides);
}

console.log('\n──── no top-3 data yet: an honest empty cell, not a guess ────');
{
  const { mod, cache } = loadModule();
  mod.renderKeywordsTable([baseKeyword({ topCompetitors: [] })]);
  const tbody = cache.keywordsTableBody;
  const rowHtml = tbody.children[0].innerHTML;
  check('shows a plain dash rather than fabricating a target rank', /—/.test(rowHtml));
  check('explains why, inviting a refresh rather than staying silent', /Refresh rankings/i.test(rowHtml));
  check('no detail row was created (nothing to expand)', tbody.children.length === 1);
}

console.log('\n──── real top-3 domains render as a toggleable list ────');
{
  const { mod, cache } = loadModule();
  const topCompetitors = [
    { position: 1, domain: 'rival.com', title: 'Rival Widgets', url: 'https://rival.com' },
    { position: 3, domain: 'other.com', title: null, url: 'https://other.com' },
  ];
  mod.renderKeywordsTable([baseKeyword({ topCompetitors })]);
  const tbody = cache.keywordsTableBody;
  check('the toggle button names the real count', /2 sites/.test(tbody.children[0].innerHTML));
  check('a detail row exists for the expandable list', tbody.children.length === 2);

  const detailRow = tbody.children[1];
  check('the detail row starts hidden', detailRow.style.display === 'none');
  check('the real domain and title appear in the detail row', /rival\.com/.test(detailRow.innerHTML) && /Rival Widgets/.test(detailRow.innerHTML));
  check('a competitor with no title still renders (no fabricated title)', /other\.com/.test(detailRow.innerHTML) && !/other\.com.*—.*null/.test(detailRow.innerHTML));
  check('the detail row spans every real column, not a stale count', /colspan="9"/.test(detailRow.innerHTML));

  mod.toggleTopCompetitors('kw1');
  check('toggling reveals the detail row', detailRow.style.display === 'table-row');
  mod.toggleTopCompetitors('kw1');
  check('toggling again hides it', detailRow.style.display === 'none');
}

console.log('\n──── domain/title are escaped, not an innerHTML injection point ────');
{
  const { mod, cache } = loadModule();
  const topCompetitors = [{ position: 1, domain: '<img src=x onerror=alert(1)>evil.com', title: '<script>alert(2)</script>', url: 'https://evil.com' }];
  mod.renderKeywordsTable([baseKeyword({ topCompetitors })]);
  const tbody = cache.keywordsTableBody;
  const detailRow = tbody.children[1];
  check('a malicious domain is escaped, not rendered as a live tag', !/<img src=x/.test(detailRow.innerHTML) && /&lt;img/.test(detailRow.innerHTML));
  check('a malicious title is escaped, not rendered as a live script tag', !/<script>alert/.test(detailRow.innerHTML));
}

console.log(failures === 0 ? '\nALL ASSERTIONS PASSED\n' : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
