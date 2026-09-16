'use strict';
/**
 * Regression test for the Brand page's health trend chart being stuck on
 * "loading..." forever. Root cause: loadBrandData() called
 * window.BrandService.getBrandHealth() but the real exported method is
 * getBrandHealthScore() — the typo made the call always fail silently, so
 * nothing ever touched #healthTrendChart after its static placeholder text.
 *
 * This extracts the real inline <script> from web/marketing/brand.html into
 * a minimal fake DOM/localStorage and exercises loadBrandData()/
 * renderHealthTrendChart() directly, rather than re-implementing the logic.
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const HTML_PATH = path.join(__dirname, '../../web/marketing/brand.html');
const html = fs.readFileSync(HTML_PATH, 'utf8');
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
assert(scriptMatch, 'expected an inline <script> block in brand.html');
const source = scriptMatch[1];

let failures = 0;
function check(name, fn) {
  try { fn(); console.log('  ok -', name); }
  catch (err) { failures++; console.log('  FAIL -', name, '-', err.message); }
}

function makeStore() {
  return {
    getItem(k) { return Object.prototype.hasOwnProperty.call(this._d, k) ? this._d[k] : null; },
    setItem(k, v) { this._d[k] = String(v); },
    removeItem(k) { delete this._d[k]; },
    _d: {},
  };
}

function makeCanvasEl() {
  return {
    _w: 320, _h: 116,
    get width() { return this._w; }, set width(v) { this._w = v; },
    get height() { return this._h; }, set height(v) { this._h = v; },
    offsetWidth: 320, offsetHeight: 116,
    getContext() {
      return {
        strokeStyle: '', lineWidth: 0, fillStyle: '',
        beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, arc() {}, fill() {},
      };
    },
  };
}

function makeGenericElement(id) {
  const el = {
    id, _html: '', children: [],
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = v; },
    textContent: '',
    style: {},
    classList: { add() {}, remove() {}, contains: () => false },
    setAttribute() {}, getAttribute: () => null,
    addEventListener() {},
    appendChild(child) { this.children.push(child); },
    querySelector() { return null; },
  };
  return el;
}

function buildFakeWindow({ healthResult, healthThrows } = {}) {
  const elements = new Map();
  const ensure = (id) => {
    if (!elements.has(id)) {
      const el = id === 'healthTrendCanvas' ? Object.assign(makeGenericElement(id), makeCanvasEl()) : makeGenericElement(id);
      elements.set(id, el);
    }
    return elements.get(id);
  };
  // Pre-seed ids referenced by the script.
  ['healthScore', 'healthArc', 'healthTrendChart', 'aiVoiceInput', 'generateVoiceBtn',
   'aiVoiceOutput', 'positioningMap', 'kpiAwareness', 'kpiAwarenessTrend', 'kpiSentiment',
   'kpiSentimentTrend', 'kpiSov', 'kpiSovTrend', 'kpiConsistency', 'kpiConsistencyTrend'].forEach(ensure);

  const localStorage = makeStore();
  const documentObj = {
    getElementById(id) {
      if (id === 'healthTrendCanvas') {
        // Reflect whatever innerHTML renderHealthTrendChart() just set on healthTrendChart.
        const wrap = elements.get('healthTrendChart');
        if (wrap && wrap._html.includes('id="healthTrendCanvas"')) return ensure('healthTrendCanvas');
        return null;
      }
      return elements.has(id) ? elements.get(id) : null;
    },
    createElement: () => makeGenericElement('canvas'),
    addEventListener() {},
  };

  const BrandService = {};
  if (healthThrows) {
    BrandService.getBrandHealthScore = async () => { throw new Error('boom'); };
  } else if (healthResult !== undefined) {
    BrandService.getBrandHealthScore = async () => healthResult;
  }

  const win = {
    document: documentObj,
    localStorage,
    console,
    Math,
    Number,
    JSON,
    Date,
    BrandService,
    APP_CONFIG: {},
  };
  return { win, elements, localStorage };
}

function loadIn(win) {
  // The real script is `(function () { 'use strict'; ...; if (document.readyState...) {...} })();`
  // Strip the outer IIFE wrapper and the auto-run init trigger at the bottom so the
  // functions we want (loadBrandData, renderHealthTrendChart, ...) become locals we
  // can return directly, instead of being trapped inside an IIFE we can't reach into.
  let body = source.replace(/^\s*\(function\s*\(\)\s*\{\s*'use strict';/, '');
  body = body.replace(/if\s*\(document\.readyState[\s\S]*\}\s*\)\s*\(\);\s*$/, '');
  const fn = new Function(
    'window', 'document', 'localStorage', 'console', 'Math', 'Number', 'JSON', 'Date',
    body + '\nreturn { loadBrandData, renderHealthTrendChart, recordHealthHistoryPoint, setHealthScore, init };'
  );
  return fn(win, win.document, win.localStorage, win.console, win.Math, win.Number, win.JSON, win.Date);
}

(async () => {
  console.log('Brand health trend chart regression tests');

  await (async () => {
    const { win, elements } = buildFakeWindow({ healthResult: { overall: 88, awareness: 70, sentiment: 40, shareOfVoice: 20, loyalty: 60 } });
    const mod = loadIn(win);
    await mod.loadBrandData();
    check('calls the real getBrandHealthScore method (not the nonexistent getBrandHealth)', () => {
      assert.strictEqual(elements.get('healthScore').textContent, 88);
    });
    check('trend chart is no longer stuck on the static "loading..." placeholder', () => {
      const html_ = elements.get('healthTrendChart')._html;
      assert(!/loading\.\.\./.test(html_), 'still shows the dead loading text: ' + html_);
    });
    check('with only one data point, shows an honest "not enough history" message, not a fake chart', () => {
      const html_ = elements.get('healthTrendChart')._html;
      assert(/Not enough history/.test(html_), 'expected the honest empty state, got: ' + html_);
    });
  })();

  await (async () => {
    const { win, elements, localStorage } = buildFakeWindow({ healthResult: { overall: 60 } });
    localStorage.setItem('audema_brand_health_history', JSON.stringify([
      { score: 40, at: '2026-01-01T00:00:00.000Z' },
      { score: 55, at: '2026-01-02T00:00:00.000Z' },
    ]));
    const mod = loadIn(win);
    await mod.loadBrandData();
    check('with 2+ real history points, renders an actual canvas instead of a placeholder message', () => {
      const html_ = elements.get('healthTrendChart')._html;
      assert(/healthTrendCanvas/.test(html_), 'expected a canvas element, got: ' + html_);
      assert(!/Not enough history/.test(html_));
    });
    check('appends the newly computed score as a real history point (never fabricated)', () => {
      const history = JSON.parse(localStorage.getItem('audema_brand_health_history'));
      assert.strictEqual(history.length, 3);
      assert.strictEqual(history[2].score, 60);
    });
  })();

  await (async () => {
    const { win, elements } = buildFakeWindow({ healthThrows: true });
    const mod = loadIn(win);
    await mod.loadBrandData();
    check('falls back to the default score (75) without crashing when BrandService throws', () => {
      assert.strictEqual(elements.get('healthScore').textContent, 75);
    });
    check('does not fabricate a history point from a failed/default read', () => {
      const raw = win.localStorage.getItem('audema_brand_health_history');
      assert(raw === null, 'expected no history to be recorded, got: ' + raw);
    });
  })();

  console.log(failures === 0 ? '\nAll brand-health-trend tests passed.' : `\n${failures} test(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
})();
