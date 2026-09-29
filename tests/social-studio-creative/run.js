/**
 * Social Studio's post-card grid gained a "Generate Reel" action wired to
 * the existing Seedance 2.0 pipeline (api/generate-video.js) — inspired by a
 * competitor's unified image/video/carousel creative grid — plus a genuine
 * per-card Download button (previously the only Download was one plain-text
 * export of every post combined).
 *
 * This pins the new client-side logic in web/agents/social-agent.html:
 * generateCardVideo()/pollCardVideoStatus() (create → poll → success/failure/
 * timeout, same async contract video-agent.html already uses) and
 * downloadCardCreative() (data: URI vs. remote-URL handling). Loads the
 * page's real inline script against a minimal fake DOM, the same technique
 * tests/load-testing-activity/run.js and tests/scotty-json-repair/run.js use
 * for other large pages.
 *
 *   node tests/social-studio-creative/run.js
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

function makeGenericElement(id) {
  const el = {
    id, style: {}, classList: { add() {}, remove() {}, toggle() {} }, dataset: {},
    children: [], value: '', textContent: '', checked: false, disabled: false,
    click() { el._clicked = true; },
    addEventListener() {},
    appendChild(child) { el.children.push(child); return child; },
    removeChild(child) { const i = el.children.indexOf(child); if (i >= 0) el.children.splice(i, 1); return child; },
    querySelector() { return makeGenericElement(id + '__q'); },
    querySelectorAll() { return []; },
    closest() { return makeGenericElement(id + '__closest'); },
  };
  Object.defineProperty(el, 'innerHTML', { get: () => el._html || '', set: (v) => { el._html = v; } });
  return el;
}

function loadPage() {
  const cache = {};
  const createdElements = [];
  const fakeDocument = {
    getElementById: (id) => cache[id] || (cache[id] = makeGenericElement(id)),
    createElement: (tag) => { const node = makeGenericElement('created-' + tag); createdElements.push(node); return node; },
    addEventListener() {},
    querySelector: () => makeGenericElement('doc-query'),
    querySelectorAll: () => [],
  };
  const openCalls = [];
  const fakeWindow = {
    open: (...args) => { openCalls.push(args); return { focus() {} }; },
    sendAuthHeaders: async () => ({ Authorization: 'Bearer t' }),
  };
  const fn = new Function('window', 'document', `${src}
return {
  generateCardVideo, pollCardVideoStatus, downloadCardCreative, condenseCardCopyForVideoPrompt,
  findReviewPost, getReviewPosts: () => _reviewPosts, setReviewPosts: (v) => { _reviewPosts = v; },
};`);
  const page = fn(fakeWindow, fakeDocument);
  return { page, createdElements, openCalls, fakeWindow };
}

console.log('\n──── condenseCardCopyForVideoPrompt: builds a real prompt from the post copy ────');
{
  const { page } = loadPage();
  const prompt = page.condenseCardCopyForVideoPrompt({ hook: 'Stop scrolling', body: 'This changes everything.', cta: 'Try it free' });
  check('joins hook, body and cta', prompt.includes('Stop scrolling') && prompt.includes('changes everything') && prompt.includes('Try it free'));

  const longPrompt = page.condenseCardCopyForVideoPrompt({ hook: 'x'.repeat(1000), body: '', cta: '' });
  check('long copy is truncated, not sent unbounded', longPrompt.length <= 510 && longPrompt.endsWith('...'));

  const empty = page.condenseCardCopyForVideoPrompt({});
  check('an empty post still returns a usable fallback prompt, not an empty string', empty.length > 0);
}

console.log('\n──── generateCardVideo → pollCardVideoStatus: the full create-then-succeed path ────');
(async () => {
  let capturedCreateBody = null;
  global.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    if (body.action === 'create') {
      capturedCreateBody = body;
      return { ok: true, json: async () => ({ taskId: 'task-1' }) };
    }
    if (body.action === 'status') {
      return { ok: true, json: async () => ({ status: 'succeeded', videoUrl: 'https://cdn.test/video-1.mp4' }) };
    }
    throw new Error('unexpected action ' + body.action);
  };

  const { page } = loadPage();
  page.setReviewPosts([{ id: 'p1', platform: 'Instagram', hook: 'Hook', body: 'Body', cta: 'Go', status: 'pending_review' }]);

  await page.generateCardVideo('p1');
  // pollCardVideoStatus schedules its own next check via setTimeout only on
  // pending/processing — this mock resolves 'succeeded' on the first status
  // call, so no timer wait is needed here.
  await new Promise((r) => setTimeout(r, 10));

  const post = page.findReviewPost('p1');
  check('a real create request was sent', !!capturedCreateBody);
  check('vertical aspect ratio for Instagram (Reels-style)', capturedCreateBody.aspectRatio === '9:16');
  check('the finished video URL lands on the post', post.videoUrl === 'https://cdn.test/video-1.mp4');
  check('loading flag is cleared on success', post._videoLoading === false);
  check('no error recorded on success', !post.videoError);

  console.log('\n──── landscape platforms get a 16:9 request instead of vertical ────');
  page.setReviewPosts([{ id: 'p2', platform: 'Twitter/X', hook: 'Hook', body: 'Body', status: 'pending_review' }]);
  await page.generateCardVideo('p2');
  check('Twitter/X gets 16:9, not the Reels default', capturedCreateBody.aspectRatio === '16:9');

  console.log('\n──── a failed render surfaces the real error, not a silent stall ────');
  global.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    if (body.action === 'create') return { ok: true, json: async () => ({ taskId: 'task-2' }) };
    return { ok: true, json: async () => ({ status: 'failed', error: 'Content policy violation' }) };
  };
  page.setReviewPosts([{ id: 'p3', platform: 'LinkedIn', status: 'pending_review' }]);
  await page.generateCardVideo('p3');
  await new Promise((r) => setTimeout(r, 10));
  const failedPost = page.findReviewPost('p3');
  check('videoError carries the real upstream reason', failedPost.videoError === 'Content policy violation');
  check('loading flag is cleared on failure', failedPost._videoLoading === false);
  check('no video URL is set on a failed render', !failedPost.videoUrl);

  console.log('\n──── a create() call that never returns a task id fails immediately, not silently ────');
  global.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    if (body.action === 'create') return { ok: true, json: async () => ({}) }; // no taskId
    throw new Error('should not reach status check');
  };
  page.setReviewPosts([{ id: 'p4', platform: 'LinkedIn', status: 'pending_review' }]);
  await page.generateCardVideo('p4');
  const noTaskPost = page.findReviewPost('p4');
  check('a missing taskId is treated as a failure', /task id/i.test(noTaskPost.videoError || ''));

  console.log('\n──── pollCardVideoStatus gives up after its attempt budget instead of polling forever ────');
  let statusCalls = 0;
  global.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    if (body.action === 'create') return { ok: true, json: async () => ({ taskId: 'task-3' }) };
    statusCalls++;
    return { ok: true, json: async () => ({ status: 'processing' }) };
  };
  // generateCardVideo() fires pollCardVideoStatus() without awaiting it (a
  // deliberately fire-and-forget poll loop, same as video-agent.html's own
  // pollSeedanceStatus) — so this needs to wait for the WHOLE chain of up to
  // 60 recursive calls to actually finish, not just the initial create call.
  // setImmediate keeps each retry off the call stack (avoiding runaway sync
  // recursion) while still needing no real wall-clock delay to flush.
  const realSetTimeout = global.setTimeout;
  global.setTimeout = (fn) => { setImmediate(fn); return 0; };
  page.setReviewPosts([{ id: 'p5', platform: 'LinkedIn', status: 'pending_review' }]);
  try {
    await page.generateCardVideo('p5');
    await new Promise((resolve) => realSetTimeout(resolve, 100));
  } finally {
    global.setTimeout = realSetTimeout;
  }
  const timedOutPost = page.findReviewPost('p5');
  check('gives up with a clear timeout message rather than polling forever', /timed out/i.test(timedOutPost.videoError || ''));
  check('the attempt count is bounded, not unlimited', statusCalls > 0 && statusCalls <= 61);

  console.log('\n──── downloadCardCreative: a data: URI downloads directly, a remote URL opens in a new tab ────');
  {
    const { page: page2, createdElements, openCalls } = loadPage();
    page2.setReviewPosts([
      { id: 'd1', platform: 'Instagram', imageUrl: 'data:image/png;base64,AAAA', status: 'pending_review' },
      { id: 'd2', platform: 'Instagram', videoUrl: 'https://cdn.test/reel.mp4', status: 'pending_review' },
    ]);

    page2.downloadCardCreative('d1');
    const anchor = createdElements.find(el => el.id.includes('created-a'));
    check('a data: URI triggers a real <a download> click, not window.open', anchor && anchor._clicked === true);
    check('the download filename is set', anchor && typeof anchor.download === 'string' && anchor.download.length > 0);

    page2.downloadCardCreative('d2');
    check('a remote video URL opens via window.open instead of a bare <a> (no CORS download guarantee)',
      openCalls.length === 1 && openCalls[0][0] === 'https://cdn.test/reel.mp4');
  }

  console.log(failures === 0 ? '\nALL ASSERTIONS PASSED\n' : `\n${failures} FAILED\n`);
  process.exit(failures === 0 ? 0 : 1);
})();
