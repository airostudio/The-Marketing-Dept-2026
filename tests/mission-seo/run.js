/**
 * The SEO agent as a real Scotty executor: the browser pipeline
 * (web/js/seo-mission.js), api/mission-seo.js, the approve path into the SEO
 * Content Engine tables, the cleanup agent, and the page.
 *
 *   node tests/mission-seo/run.js
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
const db = { artifacts: [], runs: [], topics: [], articles: [], projects: [{ id: PROJECT, user_id: OWNER }], failStep: null, conflictOnce: false, shuffleTopics: false };
let nextId = 1; const uuid = () => `ffffffff-ffff-ffff-ffff-${String(nextId++).padStart(12, '0')}`;
const q = (s, k) => { const m = s.match(new RegExp(`[?&]${k}=eq\\.([^&]+)`)); return m ? decodeURIComponent(m[1]) : null; };

mockModule('api/_lib/supabase-rest.js', {
  isUuid: (v) => /^[0-9a-f-]{36}$/i.test(String(v)),
  sbRest: async (u, k, method, p, body) => {
    if (p.startsWith('/intelligence_profiles')) { const id = q(p, 'id'), o = q(p, 'owner_id'); return { ok: true, data: [{ id: PROFILE, owner_id: OWNER }].filter(x => (!id || x.id === id) && (!o || x.owner_id === o)) }; }
    if (p.startsWith('/intelligence_profile_members')) return { ok: true, data: [] };
    if (p.startsWith('/projects')) return { ok: true, data: db.projects.filter(x => x.id === q(p, 'id') && x.user_id === q(p, 'user_id')) };
    if (p.startsWith('/seo_runs')) {
      if (method === 'DELETE') { const id = q(p, 'id'); db.runs = db.runs.filter(r => r.id !== id); db.topics = db.topics.filter(t => t.run_id !== id); db.articles = db.articles.filter(a => a.run_id !== id); return { ok: true }; }
      if (db.failStep === 'run') return { ok: false, status: 500 };
      const row = { id: uuid(), ...body }; db.runs.push(row); return { ok: true, data: [row] };
    }
    if (p.startsWith('/seo_topics')) { if (db.failStep === 'topics') return { ok: false, status: 500 }; let rows = body.map(r => ({ id: uuid(), ...r })); db.topics.push(...rows); if (db.shuffleTopics) rows = rows.slice().reverse(); return { ok: true, data: rows }; }
    if (p.startsWith('/seo_articles')) { if (db.failStep === 'articles') return { ok: false, status: 500 }; const rows = body.map(r => ({ id: uuid(), ...r })); db.articles.push(...rows); return { ok: true, data: rows }; }
    if (p.startsWith('/mission_artifacts')) {
      if (method === 'POST') { const row = { id: uuid(), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...body }; db.artifacts.push(row); return { ok: true, data: [row] }; }
      if (method === 'PATCH') {
        const id = q(p, 'id'), st = q(p, 'status'), upd = q(p, 'updated_at');
        if (db.conflictOnce && upd) { db.conflictOnce = false; return { ok: true, data: [] }; }
        const rows = db.artifacts.filter(a => a.id === id && (!st || a.status === st) && (!upd || a.updated_at === upd)); rows.forEach(a => Object.assign(a, body)); return { ok: true, data: rows };
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

const profile = { business_summary: 'Acme builds custom websites for plumbers.', business_name: 'Acme', products_services: ['Websites'], target_customer: 'Plumbers', existing_topics: ['Home'], tone_notes: 'plain' };
const topic = (n, o = {}) => ({ topic: `Topic ${n}`, target_keyword: `keyword ${n}`, search_volume: null, difficulty: null, est_search_volume: 'medium', est_difficulty: 'low', data_source: 'estimate', rationale: 'gap', content_pillar: 'Websites', ...o });
const topics = [topic(1), topic(2, { search_volume: 900, difficulty: 30, data_source: 'real' }), topic(3, { search_volume: 400, difficulty: 10, data_source: 'real' }), topic(4)];
const article = (n) => ({ title: `Article ${n}`, meta_description: 'Meta', slug: `Article ${n}!`, body_markdown: '# H1\n\n' + 'word '.repeat(50), schema_markup: [{ '@type': 'Article' }], internal_link_suggestions: ['a'], target_keyword: `keyword ${n}` });

(async () => {
  const seo = load('mission-seo'), arts = load('mission-artifacts');
  const startBody = { action: 'start', websiteUrl: 'https://a.example', profile, competitors: [{ name: 'C' }], crossCompetitorGaps: ['gap'], topics, articleTarget: 2, projectId: PROJECT, language: 'en-AU' };

  console.log('\n──── start ────');
  check('no session is refused', (await call(seo, null, startBody, true)).statusCode === 401);
  check('a missing website is refused', (await call(seo, OWNER, { ...startBody, websiteUrl: 'javascript:1' })).statusCode === 400);
  check('missing site analysis is refused', (await call(seo, OWNER, { ...startBody, profile: {} })).statusCode === 400);
  check('no usable topics is refused', (await call(seo, OWNER, { ...startBody, topics: [{ topic: '' }] })).statusCode === 400);
  check('a stranger cannot start into someone else\'s business profile', (await call(seo, STRANGER, { ...startBody, projectId: undefined, intelProfileId: PROFILE })).statusCode === 403);
  const noScope = await call(seo, OWNER, { ...startBody, projectId: undefined });
  check('with no profile or project selected it stops, saying why', noScope.statusCode === 409 && noScope.body.code === 'no_scope');
  check('none of that created an artifact', db.artifacts.length === 0);

  let r = await call(seo, OWNER, { ...startBody, topics: [...topics, topic(5, { data_source: 'real' }), topic(6, { search_volume: 50, difficulty: 5, data_source: 'real' })] });
  const art = db.artifacts[0];
  check('a plan is opened as building under the seo agent', r.body.ok && art.status === 'building' && art.agent_key === 'seo' && art.kind === 'seo_plan' && r.body.articleTarget === 2);
  check('"real" survives only with a volume number — a claimed-real topic with none is demoted to estimate', art.payload.topics[4].data_source === 'estimate' && art.payload.topics[1].data_source === 'real' && art.payload.topics[1].search_volume === 900);
  check('estimates never carry a made-up volume', art.payload.topics[0].search_volume === null && art.payload.topics[0].difficulty === null);
  check('the article target is capped by topics and by the mission limit', (await call(seo, OWNER, { ...startBody, articleTarget: 50 })).body.articleTarget === 3 && (await call(seo, OWNER, { ...startBody, topics: [topic(1)], articleTarget: 3 })).body.articleTarget === 1);
  db.artifacts.splice(1);

  console.log('\n──── addArticle ────');
  check('an unknown topic index is refused', (await call(seo, OWNER, { action: 'addArticle', artifactId: art.id, topicIndex: 99, article: article(1) })).statusCode === 400);
  check('an article with no body is refused', (await call(seo, OWNER, { action: 'addArticle', artifactId: art.id, topicIndex: 1, article: { title: 'x', body_markdown: ' ' } })).statusCode === 400);
  check('a stranger cannot add to it', (await call(seo, STRANGER, { action: 'addArticle', artifactId: art.id, topicIndex: 1, article: article(2) })).statusCode === 404);
  check('it cannot be approved while still building', (await call(arts, OWNER, { action: 'approve', artifactId: art.id })).statusCode === 409);
  r = await call(seo, OWNER, { action: 'addArticle', artifactId: art.id, topicIndex: 1, article: article(2) });
  const a1 = art.payload.articles[0];
  check('an article is saved with a clean slug and a measured word count', r.body.saved === 1 && a1.slug === 'article-2' && a1.word_count > 40 && a1.target_keyword === 'keyword 2');
  check('one more is still to come', r.body.status === 'building' && r.body.remaining === 1);
  await call(seo, OWNER, { action: 'addArticle', artifactId: art.id, topicIndex: 1, article: article(2) });
  check('repeating a topic replaces its article', art.payload.articles.length === 1);
  db.conflictOnce = true;
  check('a concurrent write is a conflict, not a silent loss', (await call(seo, OWNER, { action: 'addArticle', artifactId: art.id, topicIndex: 2, article: article(3) })).statusCode === 409);
  r = await call(seo, OWNER, { action: 'addArticle', artifactId: art.id, topicIndex: 2, article: article(3) });
  check('the last article flips it to pending approval', r.body.status === 'pending_approval' && art.status === 'pending_approval');
  check('a finished plan takes no more articles', (await call(seo, OWNER, { action: 'addArticle', artifactId: art.id, topicIndex: 0, article: article(1) })).statusCode === 409);

  console.log('\n──── approve → SEO Content Engine ────');
  db.failStep = 'articles';
  r = await call(arts, OWNER, { action: 'approve', artifactId: art.id });
  check('if a step fails, nothing is left half-saved and the approval can be retried', r.statusCode === 502 && art.status === 'pending_approval' && db.runs.length === 0 && db.topics.length === 0);
  db.failStep = null;
  r = await call(arts, OWNER, { action: 'approve', artifactId: art.id });
  check('approval saves a run, all topics and the articles', r.body.ok && r.body.result.topics === 6 && r.body.result.articles === 2 && db.runs.length === 1 && db.articles.length === 2);
  check('the run carries the site analysis and scope', db.runs[0].business_summary === profile.business_summary && db.runs[0].user_id === OWNER && db.runs[0].project_id === PROJECT && db.runs[0].status === 'ready');
  check('real volumes stay real, estimates stay estimates with no number', db.topics.find(t => t.topic === 'Topic 2').data_source === 'real' && db.topics.find(t => t.topic === 'Topic 2').search_volume === 900 && db.topics.filter(t => t.data_source === 'estimate').every(t => t.search_volume === null));
  check('only topics with articles are marked written', db.topics.filter(t => t.status === 'written').map(t => t.topic).sort().join() === 'Topic 2,Topic 3');
  check('articles are drafts, linked to their own topic', db.articles.every(a => a.status === 'draft') && db.topics.find(t => t.id === db.articles.find(a => a.title === 'Article 2').topic_id).topic === 'Topic 2');
  check('the schema markup travels with the article', Array.isArray(db.articles[0].schema_markup));
  check('it can only be approved once', (await call(arts, OWNER, { action: 'approve', artifactId: art.id })).statusCode === 409 && db.runs.length === 1);

  db.shuffleTopics = true;
  const r2 = await call(seo, OWNER, startBody); const art2 = db.artifacts.find(a => a.id === r2.body.artifactId);
  await call(seo, OWNER, { action: 'addArticle', artifactId: art2.id, topicIndex: 2, article: article(3) });
  await call(seo, OWNER, { action: 'addArticle', artifactId: art2.id, topicIndex: 1, article: article(2) });
  await call(arts, OWNER, { action: 'approve', artifactId: art2.id });
  const lastRun = db.runs[db.runs.length - 1];
  const t3 = db.topics.find(t => t.run_id === lastRun.id && t.topic === 'Topic 3');
  check('articles stay attached to the right topic even if the database returns rows in another order', db.articles.filter(a => a.run_id === lastRun.id).find(a => a.title === 'Article 3').topic_id === t3.id);
  db.shuffleTopics = false;

  console.log('\n──── cleanup agent ────');
  const { assess } = load('cron-mission-cleanup');
  const NOW = Date.now();
  const stalled = assess({ id: 'x', title: 'T', kind: 'seo_plan', status: 'building', updated_at: new Date(NOW - 60 * 60000).toISOString(), payload: { params: { articleTarget: 3 }, articles: [{ topicIndex: 0 }] } }, NOW);
  check('a plan stuck partway names the articles missing', stalled.reason === 'stalled' && /2 of 3 articles were never written/.test(stalled.message));

  console.log('\n──── the browser pipeline ────');
  const sm = require(path.join(REPO, 'web/js/seo-mission.js'));
  check('params: bare domain gets https, junk is blank, count is bounded', sm.sanitizeParams({ websiteUrl: 'acme.example', articleCount: 9 }).websiteUrl === 'https://acme.example/' && sm.sanitizeParams({ websiteUrl: 'javascript:1' }).websiteUrl === '' && sm.sanitizeParams({ websiteUrl: 'a.example', articleCount: 9 }).articleCount === 3 && sm.sanitizeParams({ websiteUrl: 'a.example' }).articleCount === 2);
  check('no website is refused', sm.missingInputs({}).length === 1);
  const pick = sm.pickTopics([topic(0), topic(1, { search_volume: 1000, difficulty: 90, data_source: 'real' }), topic(2, { search_volume: 300, difficulty: 5, data_source: 'real' }), topic(3)], 3);
  check('articles go to the topics with real volume that are winnable first, then the model\'s own order', pick.join() === '2,1,0');
  check('with no real data it keeps the model\'s order', sm.pickTopics([topic(0), topic(1), topic(2)], 2).join() === '0,1');

  const seq = []; const sent = [];
  const jr = (status, b) => ({ ok: status < 400, status, json: async () => b });
  function mkFetch(o = {}) {
    return async (url, init) => {
      const b = JSON.parse(init.body); seq.push(url + (b.action ? ':' + b.action + (b.topicIndex !== undefined ? b.topicIndex : '') : ''));
      switch (url) {
        case '/api/seo-analyze-site': return jr(200, { success: true, profile });
        case '/api/seo-search-competitors': return jr(200, { success: true, available: !o.noCompetitors, reason: 'no key', text: 't', citations: [] });
        case '/api/seo-structure-competitors': return jr(200, { success: true, competitors: [{ name: 'C' }], cross_competitor_gaps: ['g'] });
        case '/api/seo-keyword-research': sent.push(b); return jr(200, { success: true, topics: topics.map(t => ({ ...t, search_volume: null, difficulty: null, data_source: 'estimate' })) });
        case '/api/seo-keyword-volumes': if (o.volumesFail) return jr(500, { success: false, error: 'DataForSEO down' }); return jr(200, { success: true, volumes: { 'keyword 2': { search_volume: 900, difficulty: 30 }, 'keyword 3': { search_volume: 400, difficulty: 10 } }, configured: !o.volumesOff });
        case '/api/seo-write-article':
          if (o.failWrite && b.topic.topic === o.failWrite && o.failWriteCount-- > 0) return jr(502, { success: false, error: 'writer down' });
          return jr(200, { success: true, article: article(Number(b.topic.topic.split(' ')[1])) });
        case '/api/mission-seo': return b.action === 'start' ? jr(200, { ok: true, artifactId: 'A1', status: 'building', topics: b.topics, articleTarget: b.articleTarget }) : jr(200, { ok: true, status: 'building' });
      }
      throw new Error('unexpected ' + url);
    };
  }
  const headers = async () => ({ Authorization: 'Bearer t' });
  const task = { params: { websiteUrl: 'https://a.example', articleCount: 2 } };
  const out = await sm.runSeoPlan(task, { authHeaders: headers, fetchImpl: mkFetch(), language: 'en-AU', projectId: PROJECT });
  check('research runs in the SEO page\'s order before anything is saved', seq.slice(0, 6).join() === '/api/seo-analyze-site,/api/seo-search-competitors,/api/seo-structure-competitors,/api/seo-keyword-research,/api/seo-keyword-volumes,/api/mission-seo:start');
  check('the chosen language reaches the topic research', sent[0].language === 'en-AU');
  check('only the two best (real-volume) topics are written, then saved one by one', seq.slice(6).join() === '/api/seo-write-article,/api/mission-seo:addArticle1,/api/seo-write-article,/api/mission-seo:addArticle2');
  check('real volumes are merged in; the rest stay estimates', out.topics[1].data_source === 'real' && out.topics[0].data_source === 'estimate' && out.articles.length === 2 && out.complete);

  const n = seq.length; await sm.runSeoPlan(task, { authHeaders: headers, fetchImpl: mkFetch() });
  check('re-running a finished task does nothing (no second spend)', seq.length === n);

  seq.length = 0;
  const t2 = { params: { websiteUrl: 'https://a.example', articleCount: 2 } };
  let threw = ''; try { await sm.runSeoPlan(t2, { authHeaders: headers, fetchImpl: mkFetch({ failWrite: 'Topic 3', failWriteCount: 1 }) }); } catch (e) { threw = e.message; }
  check('a failing article stops the step with its reason', /writer down/.test(threw));
  check('the first article had already been saved', t2._seoState.articles.length === 1);
  seq.length = 0;
  const again = await sm.runSeoPlan(t2, { authHeaders: headers, fetchImpl: mkFetch({ failWrite: 'Topic 3', failWriteCount: 0 }) });
  check('the retry skips research and the finished article', !seq.includes('/api/seo-analyze-site') && !seq.includes('/api/mission-seo:start') && seq.filter(s => s === '/api/seo-write-article').length === 1 && again.articles.length === 2);

  const off = await sm.runSeoPlan({ params: { websiteUrl: 'https://a.example', articleCount: 1 } }, { authHeaders: headers, fetchImpl: mkFetch({ volumesOff: true, noCompetitors: true }) });
  check('missing keyword data and competitor research are reported, not hidden', /not connected/.test(off.volumesNote) && /no key/.test(off.competitorsNote));
  const failed = await sm.runSeoPlan({ params: { websiteUrl: 'https://a.example', articleCount: 1 } }, { authHeaders: headers, fetchImpl: mkFetch({ volumesFail: true }) });
  check('a failed volume lookup falls back to estimates and says so, rather than failing the mission', /lookup failed/.test(failed.volumesNote) && failed.topics.every(t => t.data_source === 'estimate'));
  threw = ''; try { await sm.runSeoPlan({ params: {} }, { authHeaders: headers, fetchImpl: mkFetch() }); } catch (e) { threw = e.message; }
  check('no website is refused before any request', /website address/.test(threw));

  console.log('\n──── Scotty ────');
  const osrc = fs.readFileSync(path.join(REPO, 'web/js/scotty-orchestrator.js'), 'utf8');
  const orch = new Function('window', 'document', `${osrc}\nreturn window.ScottyOrchestrator;`)({ SeoMission: sm, localStorage: { getItem: () => null, setItem() {}, removeItem() {} } }, { readyState: 'complete', querySelectorAll: () => [], addEventListener() {} });
  check('the SEO agent is a real executor; video and compliance are not', orch.isRealExecutor('seo') && !orch.isRealExecutor('video') && !orch.isRealExecutor('video'));
  const text = orch.describeSeoResult({ topics, competitors: [{}], articles: [{ title: 'A', word_count: 700, target_keyword: 'k' }], volumesNote: 'Real search volumes are not connected' });
  check('the report separates real volumes from estimates and says nothing is published', /2 with a real search volume, 2 estimates/.test(text) && /not connected/.test(text) && /nothing has been published/.test(text));

  const page = fs.readFileSync(path.join(REPO, 'web/scotty.html'), 'utf8');
  check('the page only runs it for a task the planner marked real, so a missing module degrades to the written plan',/task\.agentKey === 'seo' && task\.realExecutor === 'seo'/.test(page));
  check('the page loads the module and runs the SEO agent with scope and language', /<script src="\/js\/seo-mission\.js">/.test(page) && /SeoMission\.runSeoPlan\(task/.test(page) && /projectId: this\._activeProjectId\(\)/.test(page));
  check('the start gate demands a website', /SeoMission\.missingInputs\(t\.params\)/.test(page));
  check('estimates are labelled as estimates on screen; web-derived text is escaped', /\(estimate\)/.test(page) && /_renderSeoResult[\s\S]*_escapeAttr\(t\.topic\)[\s\S]*_escapeAttr\(real\.businessSummary\)/.test(page));
  check('approval says nothing is published and links to the Content Engine', /Nothing is published\./.test(page) && /Open the SEO Content Engine/.test(page));
  check('the stale "Gemini" label no longer claims to power the SEO agent', !/seo:'Gemini 2\.5 Pro'/.test(page));

  console.log(failures === 0 ? '\nALL ASSERTIONS PASSED\n' : `\n${failures} FAILED\n`);
  process.exit(failures === 0 ? 0 : 1);
})();
