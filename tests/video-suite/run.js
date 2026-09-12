/**
 * Video suite (Reel).
 *
 * The generation path itself was real and well built — a proper server-side
 * proxy to Seedance/Ark, an async create→poll contract, an honest
 * "not configured" error, and an AI-disclosure notice on every finished clip.
 * Nothing here fabricated a metric. Four findings, all about what happens
 * around the generation rather than during it:
 *
 *   1. The finished video was never kept. Ark returns a signed URL that
 *      expires within hours; the gallery stored only that URL, so a
 *      customer's video quietly became a broken <video> tag and a dead
 *      Download button. Worse, "Add to social post" wrote the same expiring
 *      link into SocialPostsStore, so a scheduled post carried a URL that
 *      would be gone before it published.
 *
 *   2. A poll that ran out of attempts marked the record 'failed' with
 *      "Timed out waiting for Seedance". Nobody observed a failure — we
 *      stopped watching. And because only pending/processing records are
 *      resumed on reload, that wrong verdict removed the only route back to
 *      a video the customer had already paid for and which was very likely
 *      still rendering.
 *
 *   3. A Tavus avatar-video path that could never run: it required a paid
 *      Tavus API key in browser config — a secret that must never be in a
 *      page — and called tavusapi.com directly, which CORS blocks. Its
 *      failure message told customers to add that key in Settings.
 *
 *   4. The gallery was localStorage-only, so a customer's videos lived on one
 *      browser. That bit hardest on a render still in progress: the provider's
 *      task id lived in the record and nowhere else, so losing it stranded a
 *      video the customer had already paid for — there is no way to ask "is it
 *      done yet" without the task id. It is now a row in video_generations.
 *
 *   node tests/video-suite/run.js
 */
const path = require('path');
const fs = require('fs');
const http = require('http');
const REPO = path.resolve(__dirname, '../..');

const fail = [];
const check = (name, cond) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name);
  if (!cond) fail.push(name);
};
const read = f => fs.readFileSync(path.join(REPO, f), 'utf8');
const code = f => read(f).split('\n')
  .filter(l => !/^\s*(\/\/|\*|\/\*|<!--)/.test(l)).join('\n');

const PAGE = 'web/agents/video-agent.html';
const API  = 'api/generate-video.js';

(async () => {
  /* ── 1. A finished video is kept somewhere durable ────────────────────── */
  console.log('──── the video outlives the link it arrived on ────');

  const api = code(API);
  check('the endpoint mirrors the finished file into our own storage',
    /mirrorToR2/.test(api) && /uploadToR2/.test(api));
  check('and says which kind of link it is handing back',
    /storage: mirror\.url \? 'permanent' : 'temporary'/.test(api));
  check('a mirror that could not happen comes with a reason, not silence',
    /storageNote/.test(api));
  check('the provider\'s own link is still returned so the file stays reachable',
    /sourceUrl,/.test(api));
  check('the copy is size-capped rather than unbounded',
    /MAX_VIDEO_BYTES/.test(api));
  check('a mirror failure does not lose the video',
    /videoUrl: mirror\.url \|\| sourceUrl/.test(api));

  // Exercise the endpoint both ways.
  const withR2 = await callStatus({ r2: true });
  check('with storage configured the customer gets our durable URL',
    withR2.body.storage === 'permanent' && /r2\.example/.test(withR2.body.videoUrl));
  const withoutR2 = await callStatus({ r2: false });
  check('without it, the temporary link is returned and labelled temporary',
    withoutR2.body.storage === 'temporary' &&
    withoutR2.body.videoUrl === 'https://ark.example/signed.mp4');
  check('and the label carries the reason',
    /R2 storage is not configured/.test(withoutR2.body.storageNote || ''));
  const stillRendering = await callStatus({ r2: true, arkStatus: 'running' });
  check('an unfinished render is not mirrored or given a URL',
    stillRendering.body.status === 'processing' && stillRendering.body.videoUrl === null);

  const page = code(PAGE);
  check('the gallery records which kind of link it holds',
    /storage: status\.storage \|\| 'temporary'/.test(page));
  check('a temporary video is flagged in the gallery',
    /This link is the generator's own and will expire/.test(page));
  check('and scheduling a post around one asks first',
    /may publish a broken video/.test(page));
  check('the review queue is told too, so the warning survives the handoff',
    /videoStorage: item\.storage/.test(page));

  /* ── 2. Not watching is not the same as failing ───────────────────────── */
  console.log('\n──── a render we stopped watching is not a failed render ────');

  check('a timeout no longer records a failure',
    !/status: 'failed', error: 'Timed out waiting for Seedance\.'/.test(page));
  check('the record stays resumable instead',
    /status: 'processing',[\s\S]{0,120}stoppedWatchingAt/.test(page));
  check('the message says we stopped watching, not that it broke',
    /We have stopped watching for now/.test(page));
  check('and there is a way back without reloading the page',
    /function recheckVideo\(/.test(page) && /Check again/.test(page));

  // The resume filter is what made the wrong verdict permanent.
  const RESUMABLE = ['processing', 'pending'];
  check('the trap is real: a record marked failed is never resumed',
    !RESUMABLE.includes('failed'));
  check('so the statuses the resume path accepts must include the timed-out one',
    /item\.status === 'processing' \|\| item\.status === 'pending'/.test(page));

  /* ── 3. The unrunnable Tavus path is gone ─────────────────────────────── */
  console.log('\n──── no feature that could never have worked ────');

  const connector = code('web/js/api-connector.js');
  check('the browser-side Tavus adapter is removed',
    !/var TavusAPI = /.test(connector));
  check('no paid key is read from page config for video',
    !/getConfig\('video\.tavus\.apiKey'\)/.test(connector));
  check('nothing calls tavusapi.com from the browser',
    !/tavusapi\.com/.test(connector));
  check('the page no longer offers the dead CTA',
    !/VideoGeneration\?\.tavus\?\.isAvailable\(\)/.test(page));
  check('and its two dead functions are gone, not left dormant',
    !/async function generateAIVideo\(\)/.test(page) &&
    !/async function pollVideoStatus\(/.test(page));
  check('no message tells the customer to add a video API key in Settings',
    !/Tavus API not configured/.test(page));
  check('the working, server-proxied path survives',
    /var SeedanceAPI = /.test(connector) && /seedance: SeedanceAPI/.test(connector));
  check('and the docs say plainly there is no Tavus integration',
    /There is no Tavus avatar-video integration/.test(read('VERCEL_SETUP.md')));

  /* ── 4. Nothing in the suite fabricates ───────────────────────────────── */
  console.log('\n──── nothing is invented ────');

  [PAGE, API, 'web/js/video-gen-store.js'].forEach(f => {
    const src = code(f);
    const randomMetrics = [...src.matchAll(/(\w+)\s*[:=]\s*[^;\n]*Math\.random/g)]
      .filter(m => !/^(id|uid|key|seed|nonce|suffix|genId|return)$/i.test(m[1]));
    check(`${path.basename(f)}: no value derived from Math.random`, randomMetrics.length === 0);
  });
  check('the endpoint still refuses honestly when no key is configured',
    /is not configured in environment variables/.test(api));
  check('and it identifies the caller before spending on a render',
    /requireUser\(req, res\)/.test(api));
  check('every finished video still carries its AI disclosure',
    /AI-generated video/.test(page));

  /* ── 5. In a browser ──────────────────────────────────────────────────── */
  console.log('\n──── the real page, in a real browser ────');

  const b = await inBrowser();
  try {
    check('the page loads with no JavaScript error', b.errors.length === 0);
    if (b.errors.length) console.log('    ', b.errors);
    check('the working generator is wired up',
      b.seedance === 'function' && b.generate === 'function');
    check('the dead Tavus surface is gone at runtime too',
      b.tavusGone && b.deadFns.every(t => t === 'undefined'));
    check('a temporary video is visibly marked in the gallery',
      /will expire/.test(b.gallery));
    check('a permanent one is not',
      (b.gallery.match(/will expire/g) || []).length === 1);
    check('an in-flight render offers "Check again"', /Check again/.test(b.galleryHtml));
    check('the store exposes its cloud API at runtime',
      b.storeApi.every(t => t === 'function'));
    check('and signed out, the gallery says the videos are device-only',
      /Sign in to keep your videos/.test(b.syncNotice || ''));
  } finally {
    await b.close();
  }

  /* ── 6. The gallery lives in the account, not one browser ────────────── */
  console.log('\n──── the gallery is not trapped on one machine ────');

  const sql = read('supabase-video-gallery.sql');
  const store = read('web/js/video-gen-store.js');

  check('there is a table for generated videos',
    /CREATE TABLE IF NOT EXISTS video_generations/.test(sql));
  check('it is row-level secured to its owner',
    /ENABLE ROW LEVEL SECURITY/.test(sql) && /auth\.uid\(\) = user_id/.test(sql));
  check('a teammate on a shared profile can see them',
    /intelligence_profile_members/.test(sql));
  check('re-saving a record updates it rather than duplicating',
    /UNIQUE \(user_id, client_id\)/.test(sql));
  check('the migration is idempotent like the others',
    /CREATE TABLE IF NOT EXISTS/.test(sql) && /DROP POLICY IF EXISTS/.test(sql));
  check('and is in the combined installer',
    /video_generations/.test(read('supabase-install-all.sql')));

  // The point of moving this: the task id is the only handle on a render that
  // is still running. Losing it strands work the customer has paid for.
  check('the provider task id is a stored column, not only a local field',
    /task_id\s+TEXT/.test(sql));
  check('and in-flight renders are indexed so they can be found again',
    /status IN \('pending', 'processing'\)/.test(sql));
  check('the storage warning is stored too, so it survives a device change',
    /storage\s+TEXT/.test(sql) && /storage_note/.test(sql));

  check('the store writes through to the cloud on create',
    /function create\(entry\)[\s\S]{0,900}pushRecord\(record\)/.test(store));
  check('and on update and delete',
    /pushRecord\(items\[idx\]\)/.test(store) && /deleteRecord\(id\)/.test(store));
  check('reads stay synchronous so the existing call sites are unchanged',
    /function list\(\) \{ return load\(\); \}/.test(store));
  check('an existing local gallery is lifted into the account once',
    /migrateLocal/.test(store));
  check('and never overwrites a gallery built on another device',
    /cloud already has records/.test(store));
  check('an offline project id is not sent into a uuid column',
    /startsWith\('local_'\)/.test(store));
  check('a failed cloud write is surfaced rather than swallowed',
    /setOnSyncChange/.test(store) && /setSyncState\(false, error\.message\)/.test(store));

  const vpage = code(PAGE);
  check('the page reconciles with the account on load',
    /syncFromCloud\(\)/.test(vpage));
  check('and resumes renders after that, so one started elsewhere is picked up',
    /syncFromCloud\(\)[\s\S]{0,300}status === 'processing' \|\| item\.status === 'pending'/.test(vpage));
  check('a save that only reached this device says so',
    /Saved on this device only/.test(vpage));
  check('and being signed out is stated rather than looking synced',
    /Sign in to keep your videos/.test(vpage));
  check('Supabase loads before the store needs it',
    read(PAGE).indexOf('supabase-client.js') < read(PAGE).indexOf('video-gen-store.js'));

  console.log('\n' + (fail.length === 0
    ? 'ALL ASSERTIONS PASSED'
    : `${fail.length} FAILED: ${fail.join(' | ')}`));
  process.exit(fail.length === 0 ? 0 : 1);
})();

/* ── helpers ─────────────────────────────────────────────────────────────── */

/** Runs the real handler's status action against a fake Ark and a fake R2. */
async function callStatus({ r2, arkStatus = 'succeeded' }) {
  const helperPath = path.join(REPO, 'api/_lib/supabase-rest.js');
  require.cache[helperPath] = {
    id: helperPath, filename: helperPath, loaded: true,
    exports: { sbRest: async () => ({ ok: true, status: 200, data: [{ id: 'user-1', plan: 'growth', role: 'user' }] }) },
  };
  const r2Path = path.join(REPO, 'api/_lib/r2.js');
  require.cache[r2Path] = {
    id: r2Path, filename: r2Path, loaded: true,
    exports: {
      isR2Configured: () => r2,
      uploadToR2: async (key) => 'https://r2.example/' + key,
    },
  };
  delete require.cache[path.join(REPO, 'api/generate-video.js')];

  global.fetch = async (url) => {
    if (String(url).includes('/auth/v1/user')) {
      return { ok: true, json: async () => ({ id: 'user-1' }) };
    }
    if (String(url).includes('/contents/generations/tasks/')) {
      return { ok: true, json: async () => ({
        status: arkStatus,
        content: { video_url: 'https://ark.example/signed.mp4', thumbnail_url: 'https://ark.example/t.jpg' },
      }) };
    }
    // The mirror fetching the finished file.
    return {
      ok: true,
      headers: { get: (h) => (h === 'content-length' ? '1024' : 'video/mp4') },
      arrayBuffer: async () => new ArrayBuffer(1024),
    };
  };

  process.env.SUPABASE_URL = 'https://x.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
  process.env.ARK_API_KEY = 'test-key';

  const handler = require(path.join(REPO, 'api/generate-video.js'));
  let status = 200, body = null;
  const res = {
    setHeader() {}, status(c) { status = c; return this; },
    json(o) { body = o; return this; }, end() { return this; },
  };
  await handler({
    method: 'POST',
    headers: { authorization: 'Bearer t', host: 'app.test', 'x-forwarded-for': '10.3.0.1' },
    body: { action: 'status', taskId: 'task-1' },
  }, res);
  return { status, body: body || {} };
}

async function inBrowser() {
  const { chromium } = require('playwright');
  const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' };
  const ROOT = path.join(REPO, 'web');
  const server = http.createServer((req, res) => {
    const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
      res.writeHead(404); return res.end('nf');
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'text/plain' });
    res.end(fs.readFileSync(f));
  });
  await new Promise(r => server.listen(0, r));
  const br = await chromium.launch();
  const p = await br.newPage();
  const errors = [];
  p.on('pageerror', e => errors.push(e.message));

  await p.addInitScript(() => localStorage.setItem('reel_videos_v1', JSON.stringify([
    { id: 'v1', prompt: 'Drone over a roof', status: 'succeeded', videoUrl: 'https://ark.example/tmp.mp4',
      storage: 'temporary', storageNote: 'R2 storage is not configured.', taskId: 't1', createdAt: new Date().toISOString() },
    { id: 'v2', prompt: 'Product close-up', status: 'succeeded', videoUrl: 'https://cdn.example/perm.mp4',
      storage: 'permanent', taskId: 't2', createdAt: new Date().toISOString() },
    { id: 'v3', prompt: 'Still rendering', status: 'processing', taskId: 't3', createdAt: new Date().toISOString() },
  ])));
  await p.route('**/api/generate-video', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'processing' }) }));
  await p.goto(`http://127.0.0.1:${server.address().port}/agents/video-agent.html`, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(1500);

  const result = await p.evaluate(() => {
    const g = document.getElementById('videogenGallery');
    return {
      seedance: typeof window.ApiConnector?.VideoGeneration?.seedance?.createVideo,
      tavusGone: window.ApiConnector?.VideoGeneration?.tavus === undefined,
      generate: typeof window.generateAIVideoClip,
      deadFns: ['generateAIVideo', 'pollVideoStatus'].map(f => typeof window[f]),
      gallery: g ? g.textContent : '',
      galleryHtml: g ? g.innerHTML : '',
      storeApi: ['create', 'update', 'remove', 'list', 'getById',
                 'syncFromCloud', 'migrateLocal', 'getSyncState', 'setOnSyncChange']
        .map(f => typeof window.VideoGenStore[f]),
      syncNotice: (document.getElementById('videoSyncState') || {}).textContent,
    };
  });
  return { ...result, errors, close: async () => { await br.close(); server.close(); } };
}
