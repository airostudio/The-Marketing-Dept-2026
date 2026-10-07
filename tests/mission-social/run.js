/**
 * Social Studio as a real Scotty executor: the shared generator
 * (api/_lib/social-posts-gen.js), api/mission-social.js, the approve path into
 * the Content Calendar, and Scotty's orchestrator/page wiring.
 *
 *   node tests/mission-social/run.js
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
const db = { artifacts: [], posts: [], projects: [{ id: PROJECT, user_id: OWNER }], failPostInsert: false };
let nextId = 1; const uuid = () => `eeeeeeee-eeee-eeee-eeee-${String(nextId++).padStart(12, '0')}`;
const q = (s, k) => { const m = s.match(new RegExp(`[?&]${k}=eq\\.([^&]+)`)); return m ? decodeURIComponent(m[1]) : null; };

mockModule('api/_lib/supabase-rest.js', {
  isUuid: (v) => /^[0-9a-f-]{36}$/i.test(String(v)),
  sbRest: async (u, k, method, p, body) => {
    if (p.startsWith('/intelligence_profiles')) { const id = q(p, 'id'), o = q(p, 'owner_id'); return { ok: true, data: [{ id: PROFILE, owner_id: OWNER }].filter(x => (!id || x.id === id) && (!o || x.owner_id === o)) }; }
    if (p.startsWith('/intelligence_profile_members')) return { ok: true, data: [] };
    if (p.startsWith('/projects')) return { ok: true, data: db.projects.filter(x => x.id === q(p, 'id') && x.user_id === q(p, 'user_id')) };
    if (p.startsWith('/social_posts')) { if (db.failPostInsert) return { ok: false, status: 500 }; const rows = body.map(r => ({ id: uuid(), ...r })); db.posts.push(...rows); return { ok: true, data: rows }; }
    if (p.startsWith('/mission_artifacts')) {
      if (method === 'POST') { const row = { id: uuid(), created_at: new Date().toISOString(), ...body }; db.artifacts.push(row); return { ok: true, data: [row] }; }
      if (method === 'PATCH') { const id = q(p, 'id'), st = q(p, 'status'); const rows = db.artifacts.filter(a => a.id === id && (!st || a.status === st)); rows.forEach(a => Object.assign(a, body)); return { ok: true, data: rows }; }
      return { ok: true, data: db.artifacts.filter(a => a.id === q(p, 'id')) };
    }
    return { ok: true, data: [] };
  },
});
mockModule('api/_lib/rate-limit.js', { rateLimited: () => false });
mockModule('api/_lib/report-failure.js', { withFailureReporting: (n, h) => h, reportFailureAsync() {}, reportFailure() {} });

let genCalls = []; let genImpl;
const gp = (platform, extra = {}) => ({ platform, title: `T ${platform}`, hook: `Hook ${platform}`, body: `Hook ${platform}\n\nBody text`, hashtags: ['#growth', 'tips'], recommendedFormat: 'Text', postingTime: 'Tue 9am', engagementNote: 'n', ...extra });
mockModule('api/_lib/social-posts-gen.js', {
  generateSocialPosts: async (a) => { genCalls.push(a); return genImpl(a); },
  renderPostsAsMarkdown: () => '', PLATFORM_STRATEGY: {}, SOCIAL_POSTS_TOOL: {},
});
genImpl = async () => ({ contentPlanNote: 'A plan', posts: [gp('LinkedIn'), gp('Twitter/X'), gp('Facebook')], usage: {} });

global.fetch = async (url) => (String(url).includes('/auth/v1/user') && global.__callerId) ? { ok: true, json: async () => ({ id: global.__callerId }) } : { ok: false };
Object.assign(process.env, { SUPABASE_URL: 'https://x.test', SUPABASE_SERVICE_ROLE_KEY: 'svc', ANTHROPIC_API_KEY: 'k' });
function load(n) { const p = path.join(REPO, `api/${n}.js`); delete require.cache[require.resolve(p)]; return require(p); }
function res() { const r = { statusCode: 200 }; r.status = (c) => { r.statusCode = c; return r; }; r.json = (d) => { r.body = d; return r; }; r.setHeader = () => {}; r.end = () => r; return r; }
async function call(h, who, body, noAuth) { global.__callerId = who; const r = res(); await h({ method: 'POST', headers: noAuth ? {} : { authorization: 'Bearer t' }, body }, r); return r; }

(async () => {
  const social = load('mission-social'), arts = load('mission-artifacts');
  const base = { action: 'generate', topic: 'Why local plumbers need a custom website', projectId: PROJECT, platforms: ['LinkedIn', 'Twitter/X', 'Facebook'], contentGoal: 'Thought Leadership', postCount: 6 };

  console.log('\n──── generate: checked before anything is spent ────');
  check('no session is refused', (await call(social, null, base, true)).statusCode === 401);
  check('an unknown action is refused', (await call(social, OWNER, { action: 'publish' })).statusCode === 400);
  const noTopic = await call(social, OWNER, { ...base, topic: '  ' });
  check('no topic is a question back, naming the field', noTopic.statusCode === 400 && noTopic.body.field === 'topic');
  check('a stranger cannot write into someone else\'s business profile', (await call(social, STRANGER, { ...base, projectId: undefined, intelProfileId: PROFILE })).statusCode === 403);
  const noScope = await call(social, OWNER, { ...base, projectId: undefined });
  check('with no profile or project selected it stops, saying why', noScope.statusCode === 409 && noScope.body.code === 'no_scope');
  check('a project that is not yours is not a scope', (await call(social, STRANGER, base)).statusCode === 409);
  check('none of that called the model or saved anything', genCalls.length === 0 && db.artifacts.length === 0);

  console.log('\n──── generate: the batch ────');
  let r = await call(social, OWNER, { ...base, platforms: ['Instagram', 'TikTok', 'LinkedIn', 'Twitter/X'], postCount: 99, contentGoal: 'Bogus', language: 'en-AU', businessContext: 'We are Acme.' });
  const art = db.artifacts[0];
  check('it is saved pending approval under the social agent', r.body.ok && art.status === 'pending_approval' && art.agent_key === 'social' && art.kind === 'social_posts');
  check('Instagram and TikTok are never requested — those need artwork', genCalls[0].platforms.join() === 'LinkedIn,Twitter/X');
  check('the post count is capped and the goal falls back safely', genCalls[0].postCount === 10 && genCalls[0].contentGoal === 'Engagement');
  check('the Business Brain context and the chosen language reach the generator', /We are Acme/.test(genCalls[0].businessContext) && /Australian English/.test(genCalls[0].businessContext));
  check('posts the generator wrote for a platform that was not asked for are dropped', art.payload.posts.every(p => ['LinkedIn', 'Twitter/X'].includes(p.platform)) && art.payload.posts.length === 2);
  check('hashtags are stored without #, since the publisher adds it', art.payload.posts[0].hashtags.join() === 'growth,tips');
  check('the result says how many are publishable', r.body.postable === 2);

  console.log('\n──── posts that cannot be published as written ────');
  genImpl = async () => ({ contentPlanNote: 'n', posts: [gp('Twitter/X', { body: 'x'.repeat(300) }), gp('LinkedIn'), gp('LinkedIn', { body: 'y'.repeat(3100) }), gp('Facebook', { body: '  ' })], usage: {} });
  r = await call(social, OWNER, base);
  const art2 = db.artifacts.find(a => a.id === r.body.artifactId);
  check('an over-length X post is flagged with the reason', /over X's 280 limit/.test(art2.payload.posts[0].problem));
  check('an over-length LinkedIn post is flagged', /LinkedIn's 3000 limit/.test(art2.payload.posts[2].problem));
  check('an empty post is dropped entirely', art2.payload.posts.length === 3);
  check('only the clean one counts as publishable', r.body.postable === 1);
  const withTags = social.postProblem('Twitter/X', 'a'.repeat(270), ['growth', 'tips']);
  check('hashtags count towards the limit, as the publisher appends them', /limit/.test(withTags));

  console.log('\n──── generator failures ────');
  genImpl = async () => { const e = new Error('Claude took too long generating 6 posts.'); e.status = 504; throw e; };
  r = await call(social, OWNER, base);
  check('a timeout is reported with its reason and nothing is saved', r.statusCode === 504 && /took too long/.test(r.body.error) && db.artifacts.length === 2);
  genImpl = async () => ({ contentPlanNote: 'n', posts: [], usage: {} });
  check('an empty batch is an error, not an empty approval', (await call(social, OWNER, base)).statusCode === 502);

  console.log('\n──── approve → Content Calendar ────');
  genImpl = async () => ({ contentPlanNote: 'n', posts: [gp('Twitter/X', { body: 'x'.repeat(300) }), gp('LinkedIn'), gp('Facebook')], usage: {} });
  r = await call(social, OWNER, base);
  const art3 = db.artifacts.find(a => a.id === r.body.artifactId);
  db.failPostInsert = true;
  r = await call(arts, OWNER, { action: 'approve', artifactId: art3.id });
  check('if the Calendar write fails the approval is handed back to retry', r.statusCode === 502 && art3.status === 'pending_approval' && db.posts.length === 0);
  db.failPostInsert = false;
  r = await call(arts, OWNER, { action: 'approve', artifactId: art3.id });
  check('only the publishable posts are sent; the over-limit one is named, not silently lost', r.body.result.posts === 2 && db.posts.length === 2 && r.body.result.skipped.length === 1 && r.body.result.skipped[0].platform === 'Twitter/X');
  check('they arrive approved and unscheduled', db.posts.every(p => p.status === 'approved' && !p.scheduled_at && !p.publish_status));
  const row = db.posts[0];
  check('copy, tags and scope land correctly', row.platform === 'LinkedIn' && /Body text/.test(row.body) && row.hashtags.includes('growth') && row.project_id === PROJECT && row.user_id === OWNER && row.source === 'organic');
  check('the suggested posting time is kept for scheduling, not applied', row.metadata.suggested_posting_time === 'Tue 9am' && row.metadata.origin_agent === 'social' && row.metadata.mission_artifact_id === art3.id);
  check('it can only be approved once', (await call(arts, OWNER, { action: 'approve', artifactId: art3.id })).statusCode === 409 && db.posts.length === 2);
  genImpl = async () => ({ contentPlanNote: 'n', posts: [gp('Twitter/X', { body: 'x'.repeat(300) })], usage: {} });
  const g4 = await call(social, OWNER, base);
  const art4 = db.artifacts.find(a => a.id === g4.body.artifactId);
  r = await call(arts, OWNER, { action: 'approve', artifactId: art4.id });
  check('a batch with nothing publishable cannot be approved, and stays pending', r.statusCode === 502 && art4.status === 'pending_approval');

  console.log('\n──── Scotty ────');
  const osrc = fs.readFileSync(path.join(REPO, 'web/js/scotty-orchestrator.js'), 'utf8');
  const orch = new Function('window', 'document', `${osrc}\nreturn window.ScottyOrchestrator;`)({ localStorage: { getItem: () => null, setItem() {}, removeItem() {} } }, { readyState: 'complete', querySelectorAll: () => [], addEventListener() {} });
  check('Social Studio is a real executor; cro and linkedin are not', orch.isRealExecutor('social') && !orch.isRealExecutor('cro') && !orch.isRealExecutor('linkedin'));
  const sp = orch.sanitizeSocialParams({ topic: ' x  y ', platforms: ['Instagram', 'TikTok', 'Facebook'], contentGoal: 'Nope', postCount: 99 });
  check('params: unsupported platforms and goals fall back, counts are bounded', sp.topic === 'x y' && sp.platforms.join() === 'Facebook' && sp.contentGoal === 'Engagement' && sp.postCount === 10);
  check('with no valid platform it defaults to LinkedIn', orch.sanitizeSocialParams({ platforms: ['Instagram'] }).platforms.join() === 'LinkedIn');
  check('no topic is a missing input', orch.missingSocialInputs({}).length === 1 && orch.missingSocialInputs({ topic: 'x' }).length === 0);
  const jr = (status, b) => ({ ok: status < 400, status, json: async () => b });
  const calls = [];
  const task = { params: { topic: 'Topic' } };
  const out = await orch.runSocialTask(task, { authHeaders: async () => ({}), projectId: PROJECT, businessContext: 'ctx', language: 'en-AU', fetchImpl: async (u, o) => { calls.push(JSON.parse(o.body)); return jr(200, { artifactId: 'a1', status: 'pending_approval', posts: [{ platform: 'LinkedIn', title: 'T', body: 'b' }], postable: 1, contentPlanNote: 'n' }); } });
  check('one request carries topic, scope, context and language', calls.length === 1 && calls[0].action === 'generate' && calls[0].projectId === PROJECT && calls[0].language === 'en-AU' && calls[0].businessContext === 'ctx' && out.complete);
  let again = 0;
  const second = await orch.runSocialTask(task, { authHeaders: async () => ({}), fetchImpl: async () => { again++; return jr(200, {}); } });
  check('a retry does not write (and pay for) a second batch', again === 0 && second.artifactId === 'a1');
  let threw = ''; try { await orch.runSocialTask({ params: {} }, { authHeaders: async () => ({}), fetchImpl: async () => jr(200, {}) }); } catch (e) { threw = e.message; }
  check('no topic is refused before any request', /what the posts should be about/.test(threw));
  threw = ''; try { await orch.runSocialTask({ params: { topic: 'x' } }, { authHeaders: async () => ({}), fetchImpl: async () => jr(409, { error: 'No business profile or project is selected' }) }); } catch (e) { threw = e.message; }
  check('the server\'s reason is what the person sees', /No business profile/.test(threw));
  check('the report names posts that will be left out', /left out when you approve/.test(orch.describeSocialResult({ contentPlanNote: 'n', posts: [{ platform: 'Twitter/X', title: 't', problem: 'too long' }] })));

  const page = fs.readFileSync(path.join(REPO, 'web/scotty.html'), 'utf8');
  check('the page runs Social Studio with scope, context and language', /orch\.runSocialTask\(task/.test(page) && /businessContext: bundle\.businessContext/.test(page));
  check('the start gate demands a topic', /missingSocialInputs\(t\.params\)/.test(page));
  check('post text from the model is escaped on screen', /_renderSocialResult[\s\S]*_escapeAttr\(p\.body\)/.test(page));
  check('approval is explicit and says nothing is scheduled or published', /Nothing is scheduled or published yet/.test(page.split('_renderSocialResult(resultEl, real) {')[1].slice(0, 3500)));

  console.log('\n──── the shared generator keeps Social Studio working ────');
  delete require.cache[require.resolve(path.join(REPO, 'api/_lib/social-posts-gen.js'))];
  mockModule('api/_lib/anthropic-headers.js', { anthropicHeaders: () => ({}) });
  const gen = require(path.join(REPO, 'api/_lib/social-posts-gen.js'));
  function sse(events) { const enc = new TextEncoder(); const text = events.map(e => `data: ${JSON.stringify(e)}\n`).join('\n'); return { ok: true, status: 200, body: new ReadableStream({ start(c) { c.enqueue(enc.encode(text)); c.close(); } }) }; }
  const good = { contentPlanNote: 'n', posts: [gp('LinkedIn')] };
  global.fetch = async () => sse([{ type: 'content_block_start', content_block: { type: 'tool_use' } }, { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: JSON.stringify(good) } }]);
  const g = await gen.generateSocialPosts({ apiKey: 'k', platforms: ['LinkedIn'], contentGoal: 'Engagement', topic: 't', frequency: '3x', postCount: 3 });
  check('a streamed tool call becomes structured posts', g.posts.length === 1 && g.contentPlanNote === 'n');
  global.fetch = async () => sse([{ type: 'message_start', message: {} }]);
  let e1; try { await gen.generateSocialPosts({ apiKey: 'k', platforms: ['LinkedIn'], contentGoal: 'x', topic: 't', frequency: 'f', postCount: 3 }); } catch (e) { e1 = e; }
  check('no tool call is a 502 with a transient-failure message', e1 && e1.status === 502 && /transient/.test(e1.message));
  global.fetch = async () => ({ ok: false, status: 429, json: async () => ({ error: { message: 'rate limited' } }) });
  let e2; try { await gen.generateSocialPosts({ apiKey: 'k', platforms: ['LinkedIn'], contentGoal: 'x', topic: 't', frequency: 'f', postCount: 3 }); } catch (e) { e2 = e; }
  check('an upstream error keeps its status and message', e2 && e2.status === 429 && /rate limited/.test(e2.message));
  global.fetch = async () => { const e = new Error('aborted due to timeout'); e.name = 'TimeoutError'; throw e; };
  let e3; try { await gen.generateSocialPosts({ apiKey: 'k', platforms: ['LinkedIn'], contentGoal: 'x', topic: 't', frequency: 'f', postCount: 3 }); } catch (e) { e3 = e; }
  check('a timeout is a 504 with honest advice', e3 && e3.status === 504 && /too long/.test(e3.message));

  console.log(failures === 0 ? '\nALL ASSERTIONS PASSED\n' : `\n${failures} FAILED\n`);
  process.exit(failures === 0 ? 0 : 1);
})();
