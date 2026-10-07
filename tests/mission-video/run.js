/**
 * Video Studio as a real Scotty executor: shot-prompt checks
 * (api/_lib/video-brief.js), api/mission-video.js start/check, the approve
 * path into the Video Studio gallery, the browser module that watches the
 * render, and the page. Nothing in the flow may post or publish anything, and
 * no paid render may start from a prompt that failed its checks.
 *
 *   node tests/mission-video/run.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
let failures = 0;
function check(label, ok) { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`); if (!ok) failures++; }
function mockModule(rel, exp) { const p = require.resolve(path.join(REPO, rel)); require.cache[p] = { id: p, filename: p, loaded: true, exports: exp }; }

const OWNER = '11111111-1111-1111-1111-111111111111';
const STRANGER = '44444444-4444-4444-4444-444444444444';
const PROFILE = '55555555-5555-5555-5555-555555555555';
const PROJECT = '66666666-6666-6666-6666-666666666666';
const db = { artifacts: [], projects: [{ id: PROJECT, user_id: OWNER }], videos: [] };
let nextId = 1; const uuid = () => `cdcdcdcd-cdcd-cdcd-cdcd-${String(nextId++).padStart(12, '0')}`;
const q = (s, k) => { const m = s.match(new RegExp(`[?&]${k}=eq\\.([^&]+)`)); return m ? decodeURIComponent(m[1]) : null; };
let videoTableMissing = false;
mockModule('api/_lib/supabase-rest.js', {
  isUuid: (v) => /^[0-9a-f-]{36}$/i.test(String(v)),
  sbRest: async (u, k, method, p, body) => {
    if (p.startsWith('/intelligence_profiles')) { const id = q(p, 'id'), o = q(p, 'owner_id'); return { ok: true, data: [{ id: PROFILE, owner_id: OWNER }].filter(x => (!id || x.id === id) && (!o || x.owner_id === o)) }; }
    if (p.startsWith('/intelligence_profile_members')) return { ok: true, data: [] };
    if (p.startsWith('/projects')) return { ok: true, data: db.projects.filter(x => x.id === q(p, 'id') && x.user_id === q(p, 'user_id')) };
    if (p.startsWith('/video_generations')) {
      if (videoTableMissing) return { ok: false, status: 404, data: null };
      if (method === 'POST') { db.videos.push(body); return { ok: true, data: [body] }; }
      return { ok: true, data: db.videos.filter(v => v.user_id === q(p, 'user_id') && v.client_id === q(p, 'client_id')) };
    }
    if (p.startsWith('/mission_artifacts')) {
      if (method === 'POST') { const row = { id: uuid(), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...JSON.parse(JSON.stringify(body)) }; db.artifacts.push(row); return { ok: true, data: [JSON.parse(JSON.stringify(row))] }; }
      if (method === 'PATCH') { const id = q(p, 'id'), st = q(p, 'status'); const rows = db.artifacts.filter(a => a.id === id && (!st || a.status === st)); rows.forEach(a => Object.assign(a, JSON.parse(JSON.stringify(body)))); return { ok: true, data: JSON.parse(JSON.stringify(rows)) }; }
      return { ok: true, data: JSON.parse(JSON.stringify(db.artifacts.filter(a => a.id === q(p, 'id')))) };
    }
    return { ok: true, data: [] };
  },
});
mockModule('api/_lib/rate-limit.js', { rateLimited: () => false });
mockModule('api/_lib/report-failure.js', { withFailureReporting: (n, h) => h, reportFailureAsync() {}, reportFailure() {} });
let r2On = true;
mockModule('api/_lib/r2.js', { isR2Configured: () => r2On, uploadToR2: async (key) => 'https://r2.example/' + key });
let claudeCalls = []; let writeImpl;
mockModule('api/_lib/nancy-claude.js', { callClaudeForJSON: async (a) => { claudeCalls.push(a); const d = writeImpl(a); return d instanceof Error ? { success: false, error: d.message } : { success: true, data: d }; }, asUntrustedContent: (t) => `<<${t}>>`, UNTRUSTED_CONTENT_RULE: 'UNTRUSTED' });

// A fake Ark: creates tasks and reports whatever status a test sets.
let arkCreates = [], arkPolls = 0, arkStatus = 'running', arkCreateFail = null, downloads = 0;
global.fetch = async (url, opts) => {
  const u = String(url);
  if (u.includes('/auth/v1/user')) return global.__callerId ? { ok: true, json: async () => ({ id: global.__callerId }) } : { ok: false };
  if (u.endsWith('/contents/generations/tasks') && opts && opts.method === 'POST') {
    if (arkCreateFail) return { ok: false, status: 404, json: async () => ({ error: { message: arkCreateFail } }) };
    arkCreates.push(JSON.parse(opts.body)); return { ok: true, json: async () => ({ id: 'task-' + arkCreates.length }) };
  }
  if (u.includes('/contents/generations/tasks/')) {
    arkPolls++;
    return { ok: true, json: async () => ({ status: arkStatus, error: arkStatus === 'failed' ? { message: 'content policy' } : undefined, content: arkStatus === 'succeeded' ? { video_url: 'https://ark.example/signed.mp4', thumbnail_url: 'https://ark.example/t.jpg' } : {} }) };
  }
  if (u === 'https://ark.example/signed.mp4') { downloads++; return { ok: true, headers: { get: (h) => (h === 'content-length' ? '1024' : 'video/mp4') }, arrayBuffer: async () => new ArrayBuffer(1024) }; }
  throw new Error('unexpected fetch to ' + u);
};
Object.assign(process.env, { SUPABASE_URL: 'https://x.test', SUPABASE_SERVICE_ROLE_KEY: 'svc', ANTHROPIC_API_KEY: 'k', ARK_API_KEY: 'ark' });
function load(n) { const p = path.join(REPO, `api/${n}.js`); delete require.cache[require.resolve(p)]; return require(p); }
function res() { const r = { statusCode: 200 }; r.status = (c) => { r.statusCode = c; return r; }; r.json = (d) => { r.body = d; return r; }; r.setHeader = () => {}; r.end = () => r; return r; }
async function call(h, who, body, noAuth) { global.__callerId = who; const r = res(); await h({ method: 'POST', headers: noAuth ? {} : { authorization: 'Bearer t' }, body }, r); return r; }

const GOOD = 'A slow dolly shot through a sunlit bakery at dawn, 35mm lens, a baker in her 30s dusting flour over fresh sourdough loaves, warm golden light, steam rising, calm mood.';

(async () => {
  const vb = require(path.join(REPO, 'api/_lib/video-brief.js'));
  console.log('\n──── what makes a shot prompt unusable ────');
  const facts = { brief: 'Our bakery, sourdough, 20% off this week' };
  check('a clean, visual prompt passes — camera numbers and ages are direction, not claims', vb.promptProblems(GOOD, facts).length === 0);
  check('quoted on-screen words are refused', vb.promptProblems(GOOD + ' A chalkboard shows "Fresh daily".', facts).some(x => /words or a logo on screen/.test(x)));
  for (const t of ['with the company logo in the corner', 'with captions', 'a sign that reads open', 'ending on a title card', 'a tagline fades in']) {
    check(`"${t}" is refused`, vb.promptProblems(`${GOOD} ${t}.`, facts).some(x => /words or a logo/.test(x)));
  }
  check('a discount the brief never gave is refused', vb.promptProblems(GOOD + ' Shoppers grab 50% off loaves.', facts).some(x => /figures that were not in the brief: 50%/.test(x)));
  check('a customer count from nowhere is refused', vb.promptProblems(GOOD + ' A queue of 500 customers.', facts).some(x => /500 customers/.test(x)));
  check('a figure the brief did give is allowed', !vb.promptProblems(GOOD + ' A tray marked down 20% sits on the counter.', facts).some(x => /figures/.test(x)));
  check('a famous person\'s likeness is refused', vb.promptProblems(GOOD + ' A celebrity chef tastes the bread.', facts).some(x => /likeness/.test(x)));
  check('too short to direct a shot is refused', vb.promptProblems('A bakery.', facts).some(x => /too short/.test(x)));

  console.log('\n──── writeShotPrompt: one rewrite, then refused ────');
  let n = 0, sawFix = null;
  let w = await vb.writeShotPrompt({ brief: 'bakery', aspectRatio: '9:16', duration: 5 }, { write: async (o) => { n++; if (o.fix) { sawFix = o.fix; return { concept: 'c', prompt: GOOD }; } return { concept: 'c', prompt: GOOD + ' With the logo.' }; } });
  check('a failing prompt is rewritten once, told exactly what was wrong', n === 2 && /words or a logo/.test(sawFix.problems[0]) && w.problems.length === 0 && w.rewritten);
  w = await vb.writeShotPrompt({ brief: 'bakery', aspectRatio: '9:16', duration: 5 }, { write: async () => ({ concept: 'c', prompt: GOOD + ' With the logo.' }) });
  check('if it still fails, its problems stand — it is never silently fixed', w.problems.length > 0);

  console.log('\n──── start: questions and refusals cost nothing ────');
  const mod = load('mission-video'), arts = load('mission-artifacts');
  const base = { action: 'start', brief: 'Our baker shaping sourdough at dawn', aspectRatio: '9:16', duration: 6, projectId: PROJECT, businessContext: 'Bakery in Leeds. Sourdough, pastries.' };
  writeImpl = () => ({ concept: 'A baker shaping sourdough at dawn.', prompt: GOOD });
  check('no session is refused', (await call(mod, null, base, true)).statusCode === 401);
  check('an unknown action is refused', (await call(mod, OWNER, { action: 'publish' })).statusCode === 400);
  const nq = await call(mod, OWNER, { ...base, brief: '' });
  check('no brief is a question back', nq.body.status === 'needs_input' && nq.body.questions[0].field === 'brief');
  delete process.env.ARK_API_KEY;
  const noKey = await call(mod, OWNER, base);
  check('with no video key it says so', noKey.statusCode === 503 && /ARK_API_KEY/.test(noKey.body.error));
  process.env.ARK_API_KEY = 'ark';
  check('a stranger cannot write into someone else\'s business profile', (await call(mod, STRANGER, { ...base, projectId: undefined, intelProfileId: PROFILE })).statusCode === 403);
  check('with no profile or project it stops, saying why', (await call(mod, OWNER, { ...base, projectId: undefined })).body.code === 'no_scope');
  check('none of that called the model, started a render or saved anything', claudeCalls.length === 0 && arkCreates.length === 0 && db.artifacts.length === 0);

  writeImpl = () => ({ concept: 'c', prompt: GOOD + ' A sign that reads "50% off".' });
  const bad = await call(mod, OWNER, base);
  check('a prompt that fails twice renders nothing and says why', bad.statusCode === 422 && bad.body.problems.length > 0 && arkCreates.length === 0 && db.artifacts.length === 0);
  check('the model was asked twice (one rewrite), with the business details fenced as data', claudeCalls.length === 2 && /<<Bakery in Leeds/.test(claudeCalls[0].user) && /UNTRUSTED/.test(claudeCalls[0].system));
  check('the rules forbid on-screen words, logos, invented figures and real people', /NO on-screen words/.test(claudeCalls[0].system) && /No real, named or famous people/.test(claudeCalls[0].system));

  console.log('\n──── start: one paid render, never lost ────');
  writeImpl = () => ({ concept: 'A baker shaping sourdough at dawn.', prompt: GOOD });
  const st = await call(mod, OWNER, base);
  const art = db.artifacts.find(a => a.id === st.body.artifactId);
  check('the render starts and the artifact is building under the video agent', st.body.status === 'rendering' && art.status === 'building' && art.agent_key === 'video' && art.kind === 'video_clip');
  check('exactly one render was started, with the requested frame and length', arkCreates.length === 1 && /--ratio 9:16 --dur 6 --resolution 1080p$/.test(arkCreates[0].content[0].text));
  check('the render\'s task id is kept on the artifact', art.payload.taskId === 'task-1');

  arkCreateFail = 'model does not exist';
  const cf = await call(mod, OWNER, base);
  const failedArt = db.artifacts.find(a => a.id === cf.body.artifactId);
  check('a render that could not start is reported and recorded as empty, with the fix spelled out', cf.statusCode === 404 && failedArt.status === 'empty' && /SEEDANCE_MODEL/.test(failedArt.payload.error));
  arkCreateFail = null;
  check('an empty one cannot be approved', (await call(arts, OWNER, { action: 'approve', artifactId: failedArt.id })).statusCode === 409);

  console.log('\n──── check: watching the render ────');
  check('a stranger cannot check on it', (await call(mod, STRANGER, { action: 'check', artifactId: art.id })).statusCode === 404);
  check('a bad id is refused', (await call(mod, OWNER, { action: 'check', artifactId: 'x' })).statusCode === 400);
  art.updated_at = '2000-01-01T00:00:00Z';
  arkStatus = 'running';
  const c1 = await call(mod, OWNER, { action: 'check', artifactId: art.id });
  check('still rendering says so, and nothing is downloaded', c1.body.status === 'rendering' && downloads === 0);
  check('watching touches the artifact so the stall sweep leaves it alone', art.updated_at !== '2000-01-01T00:00:00Z');
  check('it cannot be approved while rendering', (await call(arts, OWNER, { action: 'approve', artifactId: art.id })).statusCode === 409);

  arkStatus = 'succeeded';
  const c2 = await call(mod, OWNER, { action: 'check', artifactId: art.id });
  check('a finished render is stored in our own storage and waits for approval', c2.body.status === 'ready' && art.status === 'pending_approval' && /^https:\/\/r2\.example\//.test(c2.body.video.videoUrl) && c2.body.video.storage === 'permanent');
  const polls = arkPolls, dl = downloads;
  const c3 = await call(mod, OWNER, { action: 'check', artifactId: art.id });
  check('checking again reports what it holds — no second download, no provider call', c3.body.status === 'ready' && arkPolls === polls && downloads === dl);

  r2On = false; arkStatus = 'running';
  const st2 = await call(mod, OWNER, base); arkStatus = 'succeeded';
  const c4 = await call(mod, OWNER, { action: 'check', artifactId: st2.body.artifactId });
  check('without storage set up, the expiring link is kept and labelled temporary, with the reason', c4.body.video.storage === 'temporary' && c4.body.video.videoUrl === 'https://ark.example/signed.mp4' && /R2 storage is not configured/.test(c4.body.video.storageNote));
  r2On = true;

  arkStatus = 'running'; const st3 = await call(mod, OWNER, base); arkStatus = 'failed';
  const c5 = await call(mod, OWNER, { action: 'check', artifactId: st3.body.artifactId });
  check('a failed render is recorded as empty with the provider\'s reason', c5.body.status === 'failed' && /content policy/.test(c5.body.error) && db.artifacts.find(a => a.id === st3.body.artifactId).status === 'empty');

  const other = db.artifacts.push({ id: uuid(), user_id: OWNER, intel_profile_id: null, agent_key: 'cro', kind: 'cro_plan', status: 'building', payload: {} });
  check('check only works on video artifacts', (await call(mod, OWNER, { action: 'check', artifactId: db.artifacts[other - 1].id })).statusCode === 404);

  console.log('\n──── approve: into the Video Studio gallery, posted nowhere ────');
  const before = arkCreates.length;
  const ap = await call(arts, OWNER, { action: 'approve', artifactId: art.id });
  const row = db.videos[0];
  check('approval adds the clip to the gallery, scoped to the project', ap.body.ok && db.videos.length === 1 && row.project_id === PROJECT && row.intel_profile_id === null && row.client_id === `scotty-${art.id}`);
  check('the gallery row is a finished, durable video with its prompt and settings', row.status === 'succeeded' && row.storage === 'permanent' && row.aspect_ratio === '9:16' && row.duration === 6 && row.prompt === GOOD && row.task_id === 'task-1');
  check('approval starts no render and posts nothing', arkCreates.length === before && !db.artifacts.some(a => a.kind === 'social_posts'));
  check('it can only be approved once', (await call(arts, OWNER, { action: 'approve', artifactId: art.id })).statusCode === 409);
  const tmp = db.artifacts.find(a => a.id === st2.body.artifactId);
  const ap2 = await call(arts, OWNER, { action: 'approve', artifactId: tmp.id });
  check('a temporary-link clip keeps its temporary label in the gallery', ap2.body.result.storage === 'temporary' && db.videos[1].storage === 'temporary' && /R2 storage/.test(db.videos[1].storage_note));
  arkStatus = 'running'; const st4 = await call(mod, OWNER, base); arkStatus = 'succeeded';
  await call(mod, OWNER, { action: 'check', artifactId: st4.body.artifactId });
  videoTableMissing = true;
  const ap3 = await call(arts, OWNER, { action: 'approve', artifactId: st4.body.artifactId });
  check('if the gallery is not installed, approval fails, says how to fix it, and can be retried', ap3.statusCode === 502 && /supabase-video-gallery\.sql/.test(ap3.body.error) && db.artifacts.find(a => a.id === st4.body.artifactId).status === 'pending_approval');
  videoTableMissing = false;

  console.log('\n──── the stall sweep ────');
  const cleanup = require(path.join(REPO, 'api/cron-mission-cleanup.js'));
  const assess = cleanup.assess || (cleanup._test && cleanup._test.assess);
  if (assess) {
    const now = Date.now();
    const stalled = assess({ id: 'v1', title: 'Video — x', kind: 'video_clip', status: 'building', updated_at: new Date(now - 40 * 60000).toISOString(), payload: { taskId: 'task-9' } }, now);
    check('a render nobody has checked for half an hour is flagged, naming its task', stalled && stalled.reason === 'stalled' && /task-9/.test(stalled.message) && /Opening the mission in Scotty/.test(stalled.message));
    check('a render being watched is not', assess({ id: 'v2', title: 't', kind: 'video_clip', status: 'building', updated_at: new Date(now - 60000).toISOString(), payload: { taskId: 't' } }, now) === null);
  } else check('the stall sweep exposes assess() for testing', false);

  console.log('\n──── the browser module ────');
  const vm = require(path.join(REPO, 'web/js/video-mission.js'));
  check('params are bounded: frame from a fixed list, 2-12 seconds', JSON.stringify(vm.sanitizeParams({ brief: ' x ', aspectRatio: '21:9', duration: 99 })) === JSON.stringify({ brief: 'x', aspectRatio: '16:9', duration: 12, resolution: '1080p' }));
  check('vertical platforms get a vertical frame by default', vm.aspectForPlatform('TikTok') === '9:16' && vm.aspectForPlatform('Instagram Reels') === '9:16' && vm.aspectForPlatform('YouTube') === '16:9');
  check('a brief is required', vm.missingInputs({}).length === 1 && vm.missingInputs({ brief: 'x' }).length === 0);

  const jr = (s, b) => ({ ok: s < 400, status: s, json: async () => b });
  let reqs = [], checks = 0;
  const task = { params: { brief: 'Baker at dawn', aspectRatio: '9:16', duration: 6 } };
  const fake = (readyAfter) => async (u, o) => { const b = JSON.parse(o.body); reqs.push(b); if (b.action === 'start') return jr(200, { status: 'rendering', artifactId: 'a1', concept: 'c', prompt: GOOD, params: { ...task.params, resolution: '1080p' } }); checks++; return jr(200, checks >= readyAfter ? { status: 'ready', video: { videoUrl: 'https://r2.example/v.mp4', storage: 'permanent' } } : { status: 'rendering' }); };
  let out = await vm.runVideo(task, { authHeaders: async () => ({}), sleep: async () => {}, projectId: PROJECT, businessContext: 'Bakery', fetchImpl: fake(3) });
  check('one start, then checks until it is ready', reqs.filter(r => r.action === 'start').length === 1 && checks === 3 && out.status === 'ready' && out.video.videoUrl === 'https://r2.example/v.mp4');
  check('the start carries the brief, frame, length, business details and scope', reqs[0].brief === 'Baker at dawn' && reqs[0].aspectRatio === '9:16' && reqs[0].duration === 6 && reqs[0].businessContext === 'Bakery' && reqs[0].projectId === PROJECT);
  reqs = []; await vm.runVideo(task, { authHeaders: async () => ({}), sleep: async () => {}, fetchImpl: fake(1) });
  check('running a finished step again does not start (and pay for) a second render', reqs.length === 0);

  reqs = []; checks = 0;
  const slow = { params: { brief: 'x' } };
  out = await vm.runVideo(slow, { authHeaders: async () => ({}), sleep: async () => {}, maxChecks: 3, fetchImpl: fake(99) });
  check('when it stops watching, the render is still "rendering", not failed', out.status === 'rendering' && checks === 3);
  reqs = []; checks = 0;
  out = await vm.runVideo(slow, { authHeaders: async () => ({}), sleep: async () => {}, fetchImpl: fake(1) });
  check('running it again resumes the same render instead of starting another', reqs.every(r => r.action === 'check' && r.artifactId === 'a1') && out.status === 'ready');

  let flaky = 0;
  out = await vm.runVideo({ params: { brief: 'x' } }, { authHeaders: async () => ({}), sleep: async () => {}, fetchImpl: async (u, o) => { const b = JSON.parse(o.body); if (b.action === 'start') return jr(200, { status: 'rendering', artifactId: 'a2' }); if (++flaky < 3) return jr(502, { error: 'blip', retryable: true }); return jr(200, { status: 'ready', video: { videoUrl: 'https://r2.example/x.mp4', storage: 'permanent' } }); } });
  check('a provider blip while checking is ridden out, not reported as a failed render', out.status === 'ready');
  let threw = ''; try { await vm.runVideo({ params: { brief: 'x' } }, { authHeaders: async () => ({}), sleep: async () => {}, fetchImpl: async () => jr(422, { error: 'The shot could not be written', problems: ['It asks for words or a logo on screen.'] }) }); } catch (e) { threw = e.message; }
  check('a refused prompt surfaces with its reasons', /could not be written/.test(threw) && /logo on screen/.test(threw));
  threw = ''; try { await vm.runVideo({ params: {} }, { authHeaders: async () => ({}), fetchImpl: async () => jr(200, {}) }); } catch (e) { threw = e.message; }
  check('no brief is refused before any request', /what the video should show/.test(threw));
  const ready = vm.describeResult({ status: 'ready', params: { duration: 6, aspectRatio: '9:16' }, concept: 'c', prompt: 'p', video: { storage: 'temporary', storageNote: 'R2 off.' } });
  check('the report says nothing is posted, flags a temporary link, and discloses AI', /Nothing has been posted or published/.test(ready) && /temporary link, which expires/.test(ready) && /AI-generated video/.test(ready));

  console.log('\n──── Scotty ────');
  const osrc = fs.readFileSync(path.join(REPO, 'web/js/scotty-orchestrator.js'), 'utf8');
  const orch = new Function('window', 'document', `${osrc}\nreturn window.ScottyOrchestrator;`)({ localStorage: { getItem: () => null, setItem() {}, removeItem() {} } }, { readyState: 'complete', querySelectorAll: () => [], addEventListener() {} });
  check('Video Studio is a real executor; deck and compliance are not', orch.isRealExecutor('video') && !orch.isRealExecutor('deck') && !orch.isRealExecutor('compliance'));
  check('the planner only marks it real when the module is loaded', /agentKey === 'video' && window\.VideoMission/.test(osrc));
  check('its capability no longer promises scripts or YouTube strategy', !/video: 'Video scripts, thumbnails, YouTube strategy'/.test(osrc));
  const page = fs.readFileSync(path.join(REPO, 'web/scotty.html'), 'utf8');
  check('the page runs it only for a task the planner marked real', /task\.agentKey === 'video' && task\.realExecutor === 'video'/.test(page) && /<script src="\/js\/video-mission\.js">/.test(page));
  check('the start gate demands a brief', /VideoMission\.missingInputs\(t\.params\)/.test(page) && /t\.realExecutor !== 'video'\) continue;/.test(page));
  check('the plan card says each render is paid and nothing is posted', /Each render is paid/.test(page) && /Nothing is posted/.test(page));
  check('only an https video link is put in the player, escaped', /_renderVideoResult[\s\S]*\^https:[\s\S]*_escapeAttr\(src\)/.test(page));
  check('model text is escaped on screen', /_renderVideoResult[\s\S]*_escapeAttr\(real\.concept\)[\s\S]*_escapeAttr\(real\.prompt\)/.test(page));
  check('the result carries the AI disclosure and the temporary-link warning', /_renderVideoResult[\s\S]*AI-generated video[\s\S]*temporary link, which expires/.test(page));
  check('approval says nothing is posted', /Approving adds this clip to the Video Studio gallery\. <strong>Nothing is posted or published\.<\/strong>/.test(page));

  console.log(failures === 0 ? '\nALL ASSERTIONS PASSED\n' : `\n${failures} FAILED\n`);
  process.exit(failures === 0 ? 0 : 1);
})();
