/**
 * Ad Variants generation timed out most of the time when several platforms
 * were selected — one request asked Claude to generate every platform's
 * variants (platforms × variants) in a single 55s-budget call, and the bigger
 * that combined ask got, the more likely it was to blow the timeout.
 *
 * Fix in web/agents/social-agent.html's runAds(): call /api/generate-ads once
 * per platform, sequentially, rendering each platform's cards into the review
 * queue as soon as it succeeds instead of waiting for the whole multi-platform
 * batch. A platform that still fails/times out no longer blocks the ones that
 * already finished, and its error is surfaced without erasing the others.
 *
 * Loads the page's real inline script against a minimal fake DOM, the same
 * technique tests/social-studio-creative/run.js uses.
 *
 *   node tests/social-studio-ad-sequential/run.js
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

const html = fs.readFileSync(path.join(REPO, 'web/agents/social-agent.html'), 'utf8');
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
if (!scriptMatch) throw new Error('Could not find the inline <script> in social-agent.html');
const src = scriptMatch[1];

function makeGenericElement(id, extra) {
  const el = Object.assign({
    id, style: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, dataset: {},
    children: [], value: '', textContent: '', checked: false, disabled: false,
    addEventListener() {},
    appendChild(child) { el.children.push(child); return child; },
    querySelector: () => makeGenericElement(id + '__q'),
    querySelectorAll: () => [],
  }, extra || {});
  Object.defineProperty(el, 'innerHTML', {
    get: () => el._html || '',
    set: (v) => { el._html = v; el._htmlLog = el._htmlLog || []; el._htmlLog.push(v); },
  });
  return el;
}

function platformPill(value) {
  return makeGenericElement('pill-' + value, { dataset: { value } });
}

/**
 * @param {string[]} platforms which ad platforms appear "active" (selected)
 * @param {object} fieldValues values for adProduct/adAudience/etc.
 */
function loadPage(platforms, fieldValues = {}) {
  const cache = {};
  const get = (id, defaultValue = '') => {
    if (!cache[id]) cache[id] = makeGenericElement(id, { value: fieldValues[id] !== undefined ? fieldValues[id] : defaultValue });
    return cache[id];
  };
  // Pre-seed every field runAds() reads.
  get('adProduct', fieldValues.adProduct ?? 'A great product');
  get('adAudience', fieldValues.adAudience ?? 'Busy marketers');
  get('adObjective', fieldValues.adObjective ?? 'Conversions');
  get('adBudget', fieldValues.adBudget ?? '');
  get('adCompetitors', fieldValues.adCompetitors ?? '');
  get('adVariantCount', fieldValues.adVariantCount ?? '3');
  get('output');
  get('runBtn', { textContent: 'Generate Ad Variants' });
  get('topic');

  const fakeDocument = {
    getElementById: (id) => get(id),
    createElement: (tag) => makeGenericElement('created-' + tag),
    addEventListener() {},
    querySelector: () => makeGenericElement('doc-query'),
    querySelectorAll: (sel) => {
      if (sel === '#adPlatformPills .platform-pill.active') return platforms.map(platformPill);
      if (sel === '.framework-chip.active') return [makeGenericElement('fw', { dataset: { value: 'AIDA' } })];
      return [];
    },
  };
  const fakeWindow = { sendAuthHeaders: async () => ({ Authorization: 'Bearer t' }) };
  const fn = new Function('window', 'document', `${src}
return { SocialAgent, getReviewPosts: () => _reviewPosts, getProgress: () => _adGenProgress, getPlanNote: () => _reviewPlanNote };`);
  const mod = fn(fakeWindow, fakeDocument);
  const agent = new mod.SocialAgent();
  return { agent, mod, outputEl: cache.output, runBtn: cache.runBtn };
}

function makeVariant(platform, i) {
  return {
    platform, framework: 'AIDA', angleName: `Angle ${i}`, psychologicalTrigger: 'Curiosity',
    headline: `Headline ${platform} ${i}`, body: `Body copy for ${platform} ${i}`, cta: 'Learn More',
    visualDirection: 'Clean product shot', abHypothesis: 'Higher CTR',
  };
}

(async () => {
  console.log('\n──── each selected platform gets its own request, run one at a time ────');
  {
    const calls = [];
    let resolveOrder = [];
    global.fetch = async (url, opts) => {
      const body = JSON.parse(opts.body);
      calls.push(body);
      // Prove calls happen sequentially, not concurrently: at the moment each
      // call arrives, no later platform should have been requested yet.
      resolveOrder.push(body.platforms[0]);
      return {
        ok: true,
        json: async () => ({
          success: true,
          campaignStrategyNote: `Strategy for ${body.platforms[0]}`,
          variants: [makeVariant(body.platforms[0], 1), makeVariant(body.platforms[0], 2)],
          content: `# ${body.platforms[0]} variants`,
        }),
      };
    };

    const { agent, mod, outputEl } = loadPage(['Meta/Facebook', 'LinkedIn', 'TikTok']);
    await agent.runAds();

    check('one request per platform, not one combined request', calls.length === 3);
    check('each request asks for exactly its own platform', calls.every(c => c.platforms.length === 1));
    check('requests went out in the selected order (sequential, not parallel)',
      resolveOrder.join(',') === 'Meta/Facebook,LinkedIn,TikTok');
    check('every platform contributed its variants to the review queue',
      mod.getReviewPosts().length === 6);
  }

  console.log('\n──── results accumulate across platforms instead of the last call replacing the rest ────');
  {
    global.fetch = async (url, opts) => {
      const body = JSON.parse(opts.body);
      return {
        ok: true,
        json: async () => ({
          success: true,
          campaignStrategyNote: `Strategy for ${body.platforms[0]}`,
          variants: [makeVariant(body.platforms[0], 1), makeVariant(body.platforms[0], 2)],
          content: `# ${body.platforms[0]} variants`,
        }),
      };
    };
    const { agent, mod } = loadPage(['Meta/Facebook', 'LinkedIn']);
    await agent.runAds();
    const posts = mod.getReviewPosts();
    check('all platforms\' variants are kept (2 platforms x 2 variants = 4)', posts.length === 4);
    check('the first platform\'s posts are the ones from Meta/Facebook', posts.slice(0, 2).every(p => p.platform === 'Meta/Facebook'));
    check('the second platform\'s posts follow, not overwrite, the first', posts.slice(2).every(p => p.platform === 'LinkedIn'));
    check('every post gets a unique id even across separate requests',
      new Set(posts.map(p => p.id)).size === posts.length);
    check('strategy notes from every platform are combined, not just the last one',
      mod.getPlanNote().includes('Meta/Facebook') && mod.getPlanNote().includes('LinkedIn'));
  }

  console.log('\n──── each success renders immediately, before the remaining platforms finish ────');
  {
    let releaseSecond;
    const secondGate = new Promise((r) => { releaseSecond = r; });
    let firstRenderSeenBeforeSecondCall = false;

    global.fetch = async (url, opts) => {
      const body = JSON.parse(opts.body);
      if (body.platforms[0] === 'LinkedIn') await secondGate; // hold the 2nd call open
      return {
        ok: true,
        json: async () => ({
          success: true, campaignStrategyNote: 'note',
          variants: [makeVariant(body.platforms[0], 1)],
          content: 'x',
        }),
      };
    };

    const { agent, mod, outputEl } = loadPage(['Meta/Facebook', 'LinkedIn']);
    const runPromise = agent.runAds();
    // Let the first platform's request/response/render cycle complete.
    await new Promise((r) => setTimeout(r, 20));
    firstRenderSeenBeforeSecondCall = mod.getReviewPosts().length === 1 && outputEl.innerHTML.includes('Meta/Facebook 1');
    const bannerNamedSecondPlatform = (outputEl._htmlLog || []).some(h => /Generating LinkedIn/.test(h));
    releaseSecond();
    await runPromise;

    check('the first platform\'s card was on screen while the second was still generating',
      firstRenderSeenBeforeSecondCall);
    check('the in-progress banner named the platform currently being generated',
      bannerNamedSecondPlatform);
  }

  console.log('\n──── a failed platform does not block or erase the ones that succeeded ────');
  {
    global.fetch = async (url, opts) => {
      const body = JSON.parse(opts.body);
      if (body.platforms[0] === 'TikTok') return { ok: false, status: 502, json: async () => ({ error: 'Claude did not return structured ad variants. Try again.' }) };
      return {
        ok: true,
        json: async () => ({
          success: true, campaignStrategyNote: `Strategy for ${body.platforms[0]}`,
          variants: [makeVariant(body.platforms[0], 1)],
          content: 'x',
        }),
      };
    };
    const { agent, mod, outputEl, runBtn } = loadPage(['Meta/Facebook', 'TikTok', 'LinkedIn']);
    await agent.runAds();

    const posts = mod.getReviewPosts();
    check('the two platforms that succeeded still produced cards', posts.length === 2 && posts.every(p => p.platform !== 'TikTok'));
    check('the failed platform is named in the final banner', outputEl.innerHTML.includes('TikTok') && /Claude did not return/.test(outputEl.innerHTML));
    check('the run still finishes (button re-enabled) rather than hanging on the failure',
      runBtn.disabled === false && runBtn.textContent === 'Generate Ad Variants');
  }

  console.log('\n──── a fully clean run leaves no leftover progress banner ────');
  {
    global.fetch = async (url, opts) => {
      const body = JSON.parse(opts.body);
      return { ok: true, json: async () => ({ success: true, campaignStrategyNote: 'ok', variants: [makeVariant(body.platforms[0], 1)], content: 'x' }) };
    };
    const { agent, mod } = loadPage(['Meta/Facebook']);
    await agent.runAds();
    check('progress state is cleared once every platform succeeded', mod.getProgress() === null);
  }

  console.log(failures === 0 ? '\nALL ASSERTIONS PASSED\n' : `\n${failures} FAILED\n`);
  process.exit(failures === 0 ? 0 : 1);
})();
