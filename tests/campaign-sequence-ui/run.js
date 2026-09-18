/**
 * Social Studio's new "Campaign Sequence" mode (web/agents/social-agent.html)
 * — a deliberate pain→solution narrative arc generated via
 * api/generate-campaign-sequence.js, scheduled across a fixed Mon/Wed/Fri
 * cadence and pushed into the same review queue every other mode uses.
 *
 * This pins the client-side pieces that endpoint test alone can't cover:
 *   1. computeSequenceDates()'s cadence math (always lands on Mon/Wed/Fri,
 *      starting from the given date or the next one on/after it).
 *   2. normalizeSequencePost() carries the funnel stage/date into the card's
 *      meta text and into scheduledAt for persistence.
 *   3. runSequence() calls the right endpoint, computes dates for however
 *      many posts actually came back, and persists them with scheduledAt set
 *      (so SocialPostsStore.createBatch marks them 'scheduled', not
 *      'pending_review', unlike every other generation mode).
 *   4. Personal-profile LinkedIn publishing exists as a real second adapter,
 *      not a mode switch on the org one (api/publish-social-post.js).
 *
 *   node tests/campaign-sequence-ui/run.js
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
  Object.defineProperty(el, 'innerHTML', { get: () => el._html || '', set: (v) => { el._html = v; } });
  return el;
}

function platformPill(value) {
  return makeGenericElement('seq-pill-' + value, { dataset: { value } });
}

function loadPage(activePlatform, fieldValues = {}) {
  const cache = {};
  const get = (id, defaultValue = '') => {
    if (!cache[id]) cache[id] = makeGenericElement(id, { value: fieldValues[id] !== undefined ? fieldValues[id] : defaultValue });
    return cache[id];
  };
  get('sequencePainPoint', fieldValues.sequencePainPoint ?? 'Owners are embarrassed by their own website');
  get('sequenceProduct', fieldValues.sequenceProduct ?? 'Webese');
  get('sequenceAudience', fieldValues.sequenceAudience ?? 'Small business owners');
  get('sequencePostCount', fieldValues.sequencePostCount ?? '3');
  get('sequenceStartDate', fieldValues.sequenceStartDate ?? '2026-09-21'); // a real Monday
  get('output');
  get('runBtn', { textContent: 'Generate Campaign Sequence' });
  get('topic');

  const fakeDocument = {
    getElementById: (id) => get(id),
    createElement: (tag) => makeGenericElement('created-' + tag),
    addEventListener() {},
    querySelector: (sel) => (sel === '#sequencePlatformGrid .platform-btn.active' ? platformPill(activePlatform || 'LinkedIn') : makeGenericElement('doc-query')),
    querySelectorAll: (sel) => (sel === '.framework-chip' ? [] : []),
  };
  const fakeWindow = { sendAuthHeaders: async () => ({ Authorization: 'Bearer t' }) };
  const fn = new Function('window', 'document', `${src}
return {
  SocialAgent, computeSequenceDates, nextCadenceStartDate, normalizeSequencePost,
  getReviewPosts: () => _reviewPosts, getPlanNote: () => _reviewPlanNote,
};`);
  const mod = fn(fakeWindow, fakeDocument);
  const agent = new mod.SocialAgent();
  return { agent, mod, outputEl: cache.output, runBtn: cache.runBtn };
}

console.log('\n──── computeSequenceDates: a fixed Mon/Wed/Fri cadence ────');
{
  const { mod } = loadPage();
  // 2026-09-21 is a Monday.
  const dates = mod.computeSequenceDates('2026-09-21', 5);
  const weekdays = dates.map(d => d.getDay());
  check('starts on the given Monday itself', dates[0].getDate() === 21 && weekdays[0] === 1);
  check('every date is Mon(1)/Wed(3)/Fri(5)', weekdays.every(d => [1, 3, 5].includes(d)));
  check('dates are strictly increasing', dates.every((d, i) => i === 0 || d > dates[i - 1]));
  check('returns exactly the requested count', dates.length === 5);
}
{
  const { mod } = loadPage();
  // 2026-09-22 is a Tuesday — the cadence should roll forward to Wednesday, not use Tuesday.
  const dates = mod.computeSequenceDates('2026-09-22', 3);
  check('a non-cadence start date rolls forward to the next real cadence day', dates[0].getDay() === 3 && dates[0].getDate() === 23);
}
{
  const { mod } = loadPage();
  const iso = mod.nextCadenceStartDate();
  const d = new Date(iso + 'T00:00:00');
  check('nextCadenceStartDate() always lands on a Monday', d.getDay() === 1);
  check('nextCadenceStartDate() is always in the future, never today', d.getTime() > Date.now());
}

console.log('\n──── normalizeSequencePost: carries the funnel stage and schedule into the card ────');
{
  const { mod } = loadPage();
  const scheduled = new Date('2026-09-23T09:00:00');
  const post = mod.normalizeSequencePost(
    { sequencePosition: 2, funnelStage: 'Agitate', title: 'Post 2', hook: 'Hook', body: 'Body', hashtags: ['a'], purpose: 'Make it hurt' },
    1, scheduled, 7
  );
  check('shows the stage and position in the visible meta text', /Stage 2 of 7/.test(post.meta) && /Agitate/.test(post.meta));
  check('shows the scheduled date in the visible meta text', /Sep 23|23/.test(post.meta));
  check('carries scheduledAt as a real ISO timestamp for persistence', post.scheduledAt === scheduled.toISOString());
  check('metadata records the funnel stage and sequence position', post.metadata.funnelStage === 'Agitate' && post.metadata.sequencePosition === 2);
  check('body/hashtags/headline come straight from the generated post', post.body === 'Body' && post.headline === 'Post 2' && post.hashtags[0] === 'a');
}

console.log('\n──── runSequence(): calls the right endpoint, schedules real dates, persists them ────');
(async () => {
  let capturedBody = null;
  global.fetch = async (url, opts) => {
    if (String(url).includes('/api/generate-campaign-sequence')) {
      capturedBody = JSON.parse(opts.body);
      return {
        ok: true,
        json: async () => ({
          success: true,
          campaignNote: 'A 3-post arc.',
          posts: [
            { sequencePosition: 1, funnelStage: 'Pain', title: 'P1', hook: 'H1', body: 'B1', hashtags: [], purpose: 'x' },
            { sequencePosition: 2, funnelStage: 'Positioning', title: 'P2', hook: 'H2', body: 'B2', hashtags: [], purpose: 'y' },
            { sequencePosition: 3, funnelStage: 'Solution', title: 'P3', hook: 'H3', body: 'B3', hashtags: [], purpose: 'z' },
          ],
          content: '# sequence',
        }),
      };
    }
    throw new Error('unexpected fetch to ' + url);
  };

  const { agent, mod, outputEl, runBtn } = loadPage('LinkedIn', { sequencePostCount: '3', sequenceStartDate: '2026-09-21' });
  await agent.runSequence();

  check('called generate-campaign-sequence with the right platform and postCount', capturedBody.platform === 'LinkedIn' && capturedBody.postCount === 3);
  check('painPoint/product/audience are sent through', capturedBody.painPoint && capturedBody.product && capturedBody.audience);

  const posts = mod.getReviewPosts();
  check('all 3 posts land in the review queue', posts.length === 3);
  check('each post has a real scheduledAt, spaced across the Mon/Wed/Fri cadence', posts.every(p => !!p.scheduledAt) &&
    new Date(posts[1].scheduledAt) > new Date(posts[0].scheduledAt) && new Date(posts[2].scheduledAt) > new Date(posts[1].scheduledAt));
  check('the campaign note is stored for display', mod.getPlanNote() === 'A 3-post arc.');
  check('the run button is re-enabled with its label restored', runBtn.disabled === false && runBtn.textContent === 'Generate Campaign Sequence');

  console.log('\n──── runSequence(): a generation failure surfaces the real error, not a silent stall ────');
  global.fetch = async () => ({ ok: false, status: 502, json: async () => ({ error: 'Claude did not return a structured campaign sequence.' }) });
  const { agent: agent2, outputEl: out2 } = loadPage('LinkedIn');
  await agent2.runSequence();
  check('the real upstream error is shown', /Claude did not return/.test(out2.innerHTML));

  console.log('\n──── the schema/store/publish-adapter pieces this mode depends on are actually in place ────');
  {
    const storeSrc = fs.readFileSync(path.join(REPO, 'web/js/social-posts-store.js'), 'utf8');
    check('createBatch accepts a scheduledAt and marks the row scheduled', /p\.scheduledAt/.test(storeSrc) && /status = 'scheduled'/.test(storeSrc));

    const publishSrc = fs.readFileSync(path.join(REPO, 'api/publish-social-post.js'), 'utf8');
    check('a real personal-profile LinkedIn adapter exists, not a mode flag on the org one', /publishLinkedInPersonal/.test(publishSrc) && /'LinkedIn \(Personal\)': publishLinkedInPersonal/.test(publishSrc));
    check('the personal adapter uses its own token/URN env vars', /LINKEDIN_PERSON_ACCESS_TOKEN/.test(publishSrc) && /LINKEDIN_PERSON_URN/.test(publishSrc));

    const smSrc = fs.readFileSync(path.join(REPO, 'web/marketing/social-media.html'), 'utf8');
    check('the publish UI offers posting to the personal profile for LinkedIn posts', /Publish to Personal Profile/.test(smSrc) && /LinkedIn \(Personal\)/.test(smSrc));
  }

  console.log(failures === 0 ? '\nALL ASSERTIONS PASSED\n' : `\n${failures} FAILED\n`);
  process.exit(failures === 0 ? 0 : 1);
})();
