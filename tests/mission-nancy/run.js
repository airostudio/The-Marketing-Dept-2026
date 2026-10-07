/**
 * Nancy as a real Scotty executor: the browser-driven pipeline
 * (web/js/nancy-mission.js), the artifact endpoint (api/mission-nancy.js),
 * the approve path into the Content Calendar, the cleanup agent, and the page.
 *
 *   node tests/mission-nancy/run.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
let failures = 0;
function check(label, ok) { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`); if (!ok) failures++; }
function mockModule(rel, exp) { const p = require.resolve(path.join(REPO, rel)); require.cache[p] = { id: p, filename: p, loaded: true, exports: exp }; }

const OWNER = '11111111-1111-1111-1111-111111111111';
const EDITOR = '22222222-2222-2222-2222-222222222222';
const STRANGER = '44444444-4444-4444-4444-444444444444';
const PROFILE = '55555555-5555-5555-5555-555555555555';
const PROJECT = '66666666-6666-6666-6666-666666666666';

const db = { artifacts: [], posts: [], projects: [{ id: PROJECT, user_id: OWNER }], failPostInsert: false, conflictOnce: false };
let nextId = 1; const uuid = () => `dddddddd-dddd-dddd-dddd-${String(nextId++).padStart(12, '0')}`;
const q = (s, k) => { const m = s.match(new RegExp(`[?&]${k}=eq\\.([^&]+)`)); return m ? decodeURIComponent(m[1]) : null; };

mockModule('api/_lib/supabase-rest.js', {
  isUuid: (v) => /^[0-9a-f-]{36}$/i.test(String(v)),
  sbRest: async (u, k, method, p, body) => {
    if (p.startsWith('/intelligence_profiles')) { const id = q(p, 'id'), o = q(p, 'owner_id'); return { ok: true, data: [{ id: PROFILE, owner_id: OWNER }].filter(x => (!id || x.id === id) && (!o || x.owner_id === o)) }; }
    if (p.startsWith('/intelligence_profile_members')) { const pid = q(p, 'profile_id'), uid = q(p, 'user_id'); return { ok: true, data: [{ profile_id: PROFILE, user_id: EDITOR, role: 'editor' }].filter(m => (!pid || m.profile_id === pid) && (!uid || m.user_id === uid)) }; }
    if (p.startsWith('/projects')) return { ok: true, data: db.projects.filter(x => x.id === q(p, 'id') && x.user_id === q(p, 'user_id')) };
    if (p.startsWith('/social_posts')) {
      if (db.failPostInsert) return { ok: false, status: 500 };
      const rows = (Array.isArray(body) ? body : [body]).map(r => ({ id: uuid(), ...r })); db.posts.push(...rows); return { ok: true, data: rows };
    }
    if (p.startsWith('/mission_artifacts')) {
      if (method === 'POST') { const row = { id: uuid(), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...body }; db.artifacts.push(row); return { ok: true, data: [row] }; }
      if (method === 'PATCH') {
        const id = q(p, 'id'), status = q(p, 'status'), upd = q(p, 'updated_at');
        if (db.conflictOnce && upd) { db.conflictOnce = false; return { ok: true, data: [] }; }
        const rows = db.artifacts.filter(a => a.id === id && (!status || a.status === status) && (!upd || a.updated_at === upd));
        rows.forEach(a => Object.assign(a, body)); return { ok: true, data: rows };
      }
      return { ok: true, data: db.artifacts.filter(a => a.id === q(p, 'id')) };
    }
    return { ok: true, data: [] };
  },
});
mockModule('api/_lib/rate-limit.js', { rateLimited: () => false });
mockModule('api/_lib/report-failure.js', { withFailureReporting: (n, h) => h, reportFailureAsync() {}, reportFailure() {} });
global.fetch = async (url) => (String(url).includes('/auth/v1/user') && global.__callerId) ? { ok: true, json: async () => ({ id: global.__callerId }) } : { ok: false };
Object.assign(process.env, { SUPABASE_URL: 'https://x.test', SUPABASE_SERVICE_ROLE_KEY: 'svc' });
function load(n) { const p = path.join(REPO, `api/${n}.js`); delete require.cache[require.resolve(p)]; return require(p); }
function res() { const r = { statusCode: 200 }; r.status = (c) => { r.statusCode = c; return r; }; r.json = (d) => { r.body = d; return r; }; r.setHeader = () => {}; r.end = () => r; return r; }
async function call(h, who, body, noAuth) { global.__callerId = who; const r = res(); await h({ method: 'POST', headers: noAuth ? {} : { authorization: 'Bearer t' }, body }, r); return r; }

const research = { businessProfile: { business_name: 'Acme Plumbing', primary_offer: 'Emergency call-outs' }, brand: { primary_colour: '#123456' }, strategy: { content_opportunities: [] } };
const plan = (day, o = {}) => ({ day, objective: 'Educate', content_pillar: 'Tips', format: 'single', hook: `Hook ${day}`, slide_headline: `Headline ${day}`, caption: `Caption for day ${day}\n\nSecond line`, cta: 'Call us', visual_direction: 'Bright', hashtags: ['plumbing', '#tips'], uses_user_photo: false, ...o });
const img = 'https://cdn.example.com/p.png';

(async () => {
  const nancy = load('mission-nancy'), arts = load('mission-artifacts');

  console.log('\n──── start ────');
  check('no session is refused', (await call(nancy, null, { action: 'start' }, true)).statusCode === 401);
  check('a missing website is a clear 400', (await call(nancy, OWNER, { action: 'start', ...research, projectId: PROJECT })).statusCode === 400);
  check('research that never happened is refused', (await call(nancy, OWNER, { action: 'start', websiteUrl: 'https://a.example', projectId: PROJECT })).statusCode === 400);
  check('a stranger cannot start into someone else\'s business profile', (await call(nancy, STRANGER, { action: 'start', websiteUrl: 'https://a.example', ...research, intelProfileId: PROFILE })).statusCode === 403);
  const noScope = await call(nancy, OWNER, { action: 'start', websiteUrl: 'https://a.example', ...research });
  check('with no profile or project selected it stops before anything is spent, saying why', noScope.statusCode === 409 && noScope.body.code === 'no_scope');
  check('a project that is not yours does not count as a scope', (await call(nancy, STRANGER, { action: 'start', websiteUrl: 'https://a.example', ...research, projectId: PROJECT })).statusCode === 409);
  check('none of those created an artifact', db.artifacts.length === 0);

  let r = await call(nancy, OWNER, { action: 'start', websiteUrl: 'https://a.example', language: 'en-AU', ...research, projectId: PROJECT, missionId: 'm1' });
  const art = db.artifacts.find(a => a.id === r.body.artifactId);
  check('a week is opened as building under the nancy agent, with 7 days to go', r.body.ok && art.status === 'building' && art.agent_key === 'nancy' && art.kind === 'nancy_week' && r.body.remaining === 7);
  check('the research, language and scope are kept', art.payload.businessProfile.business_name === 'Acme Plumbing' && art.payload.params.language === 'en-AU' && art.payload.params.projectId === PROJECT);
  const zz = await call(nancy, OWNER, { action: 'start', websiteUrl: 'https://a.example', language: 'zz', ...research, projectId: PROJECT });
  check('a bad language code is dropped, not stored', db.artifacts.find(a => a.id === zz.body.artifactId).payload.params.language === '');
  db.artifacts.splice(db.artifacts.findIndex(a => a.id === zz.body.artifactId), 1);

  console.log('\n──── addPost ────');
  check('a post with no hosted image is refused, with the reason', await (async () => { const x = await call(nancy, OWNER, { action: 'addPost', artifactId: art.id, post: plan(1), asset: { hostedUrl: '', format: 'ai' } }); return x.statusCode === 422 && x.body.code === 'no_hosted_image'; })());
  check('a non-https image address is refused', (await call(nancy, OWNER, { action: 'addPost', artifactId: art.id, post: plan(1), asset: { hostedUrl: 'http://x.example/p.png' } })).statusCode === 422);
  check('a javascript: image address is refused', (await call(nancy, OWNER, { action: 'addPost', artifactId: art.id, post: plan(1), asset: { hostedUrl: 'javascript:alert(1)' } })).statusCode === 422);
  check('a day outside the week is refused', (await call(nancy, OWNER, { action: 'addPost', artifactId: art.id, post: plan(9), asset: { hostedUrl: img } })).statusCode === 400);
  check('a post with no caption is refused', (await call(nancy, OWNER, { action: 'addPost', artifactId: art.id, post: plan(1, { caption: ' ' }), asset: { hostedUrl: img } })).statusCode === 400);
  check('a stranger cannot add to it', (await call(nancy, STRANGER, { action: 'addPost', artifactId: art.id, post: plan(1), asset: { hostedUrl: img } })).statusCode === 404);
  check('none of those saved a day', art.payload.posts.length === 0);

  r = await call(nancy, EDITOR, { action: 'addPost', artifactId: art.id, post: plan(1), asset: { hostedUrl: img, format: 'ai' } });
  check('a week with no shared profile belongs to its owner alone — a teammate gets not-found', r.statusCode === 404 && art.payload.posts.length === 0);
  r = await call(nancy, OWNER, { action: 'addPost', artifactId: art.id, post: plan(1, { caption: 'X'.repeat(5000), hashtags: ['a b', '#c', '', 'd'.repeat(100)] }), asset: { hostedUrl: img, format: 'ai' } });
  const d1 = art.payload.posts.find(p => p.day === 1);
  check('a day is saved with bounded fields', r.body.ok && d1.caption.length === 2200 && d1.hashtags.every(t => !t.startsWith('#') && !/\s/.test(t) && t.length <= 60));
  r = await call(nancy, OWNER, { action: 'addPost', artifactId: art.id, post: plan(1), asset: { hostedUrl: img, format: 'ai' } });
  check('repeating a day replaces it instead of duplicating', art.payload.posts.filter(p => p.day === 1).length === 1 && r.body.saved === 1);
  db.conflictOnce = true;
  check('a concurrent write is reported as a conflict, not silently lost', (await call(nancy, OWNER, { action: 'addPost', artifactId: art.id, post: plan(2), asset: { hostedUrl: img } })).statusCode === 409);
  check('it cannot be approved while still building', (await call(arts, OWNER, { action: 'approve', artifactId: art.id })).statusCode === 409);
  for (let d = 2; d <= 6; d++) await call(nancy, OWNER, { action: 'addPost', artifactId: art.id, post: plan(d), asset: { hostedUrl: img, format: d === 3 ? 'svg' : 'ai', fallbackReason: d === 3 ? 'AI image failed' : undefined } });
  check('six days in, it is still building', art.status === 'building' && art.payload.posts.length === 6);
  r = await call(nancy, OWNER, { action: 'addPost', artifactId: art.id, post: plan(7), asset: { hostedUrl: img, format: 'ai' } });
  check('the seventh day flips it to pending approval', r.body.status === 'pending_approval' && r.body.remaining === 0 && art.status === 'pending_approval');
  check('days are kept in order', art.payload.posts.map(p => p.day).join() === '1,2,3,4,5,6,7');
  check('a simple-graphic fallback is remembered, so the person is told', art.payload.posts[2].imageFallback === 'AI image failed');
  check('a finished week takes no more posts', (await call(nancy, OWNER, { action: 'addPost', artifactId: art.id, post: plan(1), asset: { hostedUrl: img } })).statusCode === 409);

  console.log('\n──── approve → Content Calendar ────');
  db.failPostInsert = true;
  r = await call(arts, OWNER, { action: 'approve', artifactId: art.id });
  check('if the Calendar write fails the approval is handed back to retry', r.statusCode === 502 && art.status === 'pending_approval' && db.posts.length === 0);
  db.failPostInsert = false;
  r = await call(arts, OWNER, { action: 'approve', artifactId: art.id });
  check('approval sends all seven posts', r.body.ok && r.body.result.posts === 7 && db.posts.length === 7 && r.body.result.ids.length === 7);
  const row = db.posts[0];
  check('they arrive APPROVED and unscheduled — nothing is queued to publish', db.posts.every(p => p.status === 'approved' && !p.scheduled_at && !p.publish_status));
  check('they are organic Instagram posts for this user, in one batch', db.posts.every(p => p.source === 'organic' && p.platform === 'Instagram' && p.user_id === OWNER && p.batch_id === row.batch_id));
  check('they carry the hosted image and are marked rendered', db.posts.every(p => p.image_url === img && p.image_render_status === 'rendered'));
  check('the project scope is kept so the Calendar can show them', db.posts.every(p => p.project_id === PROJECT && p.intel_profile_id === null));
  check('copy lands in the right columns', row.headline === 'Headline 1' && /Caption for day 1/.test(row.body) && row.cta === 'Call us' && row.hashtags.includes('plumbing') && row.hashtags.includes('tips'));
  check('provenance says Nancy, the day, and the mission artifact', row.metadata.origin_agent === 'nancy' && row.metadata.day === 1 && row.metadata.mission_artifact_id === art.id && row.metadata.approved_in === 'scotty_mission');
  check('it can only be approved once — no duplicate posts', (await call(arts, OWNER, { action: 'approve', artifactId: art.id })).statusCode === 409 && db.posts.length === 7);

  console.log('\n──── cleanup agent ────');
  const { assess } = load('cron-mission-cleanup');
  const NOW = Date.now();
  const stalled = assess({ id: 'x', title: 'T', kind: 'nancy_week', status: 'building', updated_at: new Date(NOW - 60 * 60000).toISOString(), payload: { posts: [{ day: 1 }, { day: 2 }] } }, NOW);
  check('a week stuck partway is flagged with the days missing', stalled.reason === 'stalled' && /5 of 7 days/.test(stalled.message));

  console.log('\n──── the browser pipeline ────');
  const nm = require(path.join(REPO, 'web/js/nancy-mission.js'));
  check('params: bare domain gets https, junk is blank', nm.sanitizeParams({ websiteUrl: 'acme.example' }).websiteUrl === 'https://acme.example/' && nm.sanitizeParams({ websiteUrl: 'javascript:1' }).websiteUrl === '' && nm.sanitizeParams({ websiteUrl: 'nodots' }).websiteUrl === '');
  check('no website is refused', nm.missingInputs({}).length === 1);

  const seq = []; const sentToServer = [];
  let failRenderOnce = 0;
  const jr = (status, b) => ({ ok: status < 400, status, json: async () => b });
  function mkFetch(opts = {}) {
    return async (url, o) => {
      const b = JSON.parse(o.body); seq.push(url + (b.action ? ':' + b.action : (b.dayRange ? ':' + b.dayRange[0] : '')));
      switch (url) {
        case '/api/nancy-analyze-website': return jr(200, { success: true, profile: research.businessProfile });
        case '/api/nancy-screenshot': return jr(200, { success: true, origin: 'https://a.example', screenshot: { available: true, dataUri: 'data:x' }, colourCandidates: {}, fontHints: [] });
        case '/api/nancy-brand-identity': return jr(200, { success: true, brand: research.brand });
        case '/api/nancy-search-competitors': return jr(200, { success: true, available: false, reason: 'no key' });
        case '/api/nancy-strategy': return jr(200, { success: true, strategy: research.strategy });
        case '/api/nancy-content-plan': return jr(200, { success: true, posts: [plan(b.dayRange[0])] });
        case '/api/nancy-render-week':
          if (opts.failRenderDay && b.post.day === opts.failRenderDay && failRenderOnce++ === 0) return jr(502, { success: false, error: 'render down' });
          return jr(200, { success: true, asset: { hostedUrl: opts.noHost ? undefined : img, format: 'ai', dataUri: 'data:big' } });
        case '/api/mission-nancy': sentToServer.push(o.body); if (b.action === 'addPost' && !b.asset.hostedUrl) return jr(422, { error: "Day image has no hosted address. Image hosting (R2) is not configured, so this week could not be posted.", code: 'no_hosted_image' }); return b.action === 'start' ? jr(200, { ok: true, artifactId: 'A1', status: 'building' }) : jr(200, { ok: true, status: b.post.day === 7 ? 'pending_approval' : 'building' });
      }
      throw new Error('unexpected ' + url);
    };
  }
  const headers = async () => ({ Authorization: 'Bearer t' });
  const task = { params: { websiteUrl: 'https://a.example', mustTalkAbout: 'Winter special' } };
  const out = await nm.runNancyWeek(task, { authHeaders: headers, fetchImpl: mkFetch(), language: 'en-AU', projectId: PROJECT });
  check('research runs in the page\'s order before anything is saved', seq.slice(0, 6).join() === '/api/nancy-analyze-website,/api/nancy-screenshot,/api/nancy-brand-identity,/api/nancy-search-competitors,/api/nancy-strategy,/api/mission-nancy:start');
  check('each day is written, rendered, then saved, in order', seq.slice(6, 9).join() === '/api/nancy-content-plan:1,/api/nancy-render-week,/api/mission-nancy:addPost' && out.posts.length === 7 && out.complete);
  check('the finished week is reported pending approval', out.status === 'pending_approval' && out.artifactId === 'A1');
  check('the big image data is never sent to the server', sentToServer.length > 0 && sentToServer.every(x => !x.includes('data:big')));

  const n = seq.length;
  await nm.runNancyWeek(task, { authHeaders: headers, fetchImpl: mkFetch() });
  check('re-running a finished task does nothing (no second spend)', seq.length === n);

  seq.length = 0; failRenderOnce = 0;
  const t2 = { params: { websiteUrl: 'https://a.example' } };
  let threw = ''; try { await nm.runNancyWeek(t2, { authHeaders: headers, fetchImpl: mkFetch({ failRenderDay: 4 }) }); } catch (e) { threw = e.message; }
  check('a failing image render stops the step with its reason', /render down/.test(threw));
  const savedBefore = seq.filter(s => s === '/api/mission-nancy:addPost').length;
  check('days 1–3 had already been saved', savedBefore === 3 && t2._nancyState.posts.length === 3);
  seq.length = 0;
  const again = await nm.runNancyWeek(t2, { authHeaders: headers, fetchImpl: mkFetch() });
  check('the retry skips research and days 1–3, resuming at day 4', !seq.includes('/api/nancy-analyze-website') && !seq.includes('/api/mission-nancy:start') && seq[0] === '/api/nancy-content-plan:4' && again.posts.length === 7);

  seq.length = 0;
  threw = ''; try { await nm.runNancyWeek({ params: { websiteUrl: 'https://a.example' } }, { authHeaders: headers, fetchImpl: mkFetch({ noHost: true }) }); } catch (e) { threw = e.message; }
  check('with no hosted image (R2 off) the endpoint\'s refusal is a failed step, not a fake success', /R2\) is not configured/.test(threw));
  threw = ''; try { await nm.runNancyWeek({ params: {} }, { authHeaders: headers, fetchImpl: mkFetch() }); } catch (e) { threw = e.message; }
  check('no website is refused before any request', /website address/.test(threw));

  console.log('\n──── Scotty ────');
  const osrc = fs.readFileSync(path.join(REPO, 'web/js/scotty-orchestrator.js'), 'utf8');
  const orch = new Function('window', 'document', `${osrc}\nreturn window.ScottyOrchestrator;`)({ NancyMission: nm, localStorage: { getItem: () => null, setItem() {}, removeItem() {} } }, { readyState: 'complete', querySelectorAll: () => [], addEventListener() {} });
  check('Nancy is a real executor; analytics (no real pipeline yet) is not', orch.isRealExecutor('nancy') && !orch.isRealExecutor('analytics'));
  check('the report lists each day and what is waiting', /Day 1/.test(orch.describeNancyResult({ businessName: 'Acme', posts: [{ day: 1, hook: 'H', content_pillar: 'Tips' }, { day: 2, hook: 'H2', imageFallback: 'x' }] })) && /simple graphic/.test(orch.describeNancyResult({ posts: [{ day: 2, hook: 'H2', imageFallback: 'x' }] })) && /nothing has been scheduled or published/.test(orch.describeNancyResult({ posts: [] })));

  const page = fs.readFileSync(path.join(REPO, 'web/scotty.html'), 'utf8');
  check('the page loads the Nancy mission module', /<script src="\/js\/nancy-mission\.js">/.test(page));
  check('the page runs Nancy before the generic executor, with scope and language', page.indexOf("task.agentKey === 'nancy'") < page.indexOf("orch.isRealExecutor(task.agentKey)") && /projectId: this\._activeProjectId\(\)/.test(page) && /language: \(contextBundle && contextBundle\.language\)/.test(page));
  check('the start gate demands a website', /NancyMission\.missingInputs\(t\.params\)/.test(page));
  check('only https images are shown, all values escaped', /\^https:/.test(page.split('_renderNancyResult(resultEl, real) {')[1].slice(0, 600)) && /_escapeAttr\(p\.caption\)/.test(page));
  check('approval says nothing is scheduled or published and links to the Calendar', /Nothing is scheduled or published yet/.test(page) && /open the Content Calendar to schedule them/.test(page));

  console.log(failures === 0 ? '\nALL ASSERTIONS PASSED\n' : `\n${failures} FAILED\n`);
  process.exit(failures === 0 ? 0 : 1);
})();
