/**
 * The Ad Creative Lab as a real Scotty executor: the browser pipeline
 * (web/js/ads-mission.js), api/mission-ads.js (platform-limit checks), the
 * approve path into ad copy, the Content Calendar keeping ad copy apart from
 * schedulable posts, and the page.
 *
 *   node tests/mission-ads/run.js
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
const db = { artifacts: [], posts: [], projects: [{ id: PROJECT, user_id: OWNER }], failInsert: false };
let nextId = 1; const uuid = () => `abababab-abab-abab-abab-${String(nextId++).padStart(12, '0')}`;
const q = (s, k) => { const m = s.match(new RegExp(`[?&]${k}=eq\\.([^&]+)`)); return m ? decodeURIComponent(m[1]) : null; };

mockModule('api/_lib/supabase-rest.js', {
  isUuid: (v) => /^[0-9a-f-]{36}$/i.test(String(v)),
  sbRest: async (u, k, method, p, body) => {
    if (p.startsWith('/intelligence_profiles')) { const id = q(p, 'id'), o = q(p, 'owner_id'); return { ok: true, data: [{ id: PROFILE, owner_id: OWNER }].filter(x => (!id || x.id === id) && (!o || x.owner_id === o)) }; }
    if (p.startsWith('/intelligence_profile_members')) return { ok: true, data: [] };
    if (p.startsWith('/projects')) return { ok: true, data: db.projects.filter(x => x.id === q(p, 'id') && x.user_id === q(p, 'user_id')) };
    if (p.startsWith('/social_posts')) { if (db.failInsert) return { ok: false, status: 500 }; const rows = body.map(r => ({ id: uuid(), ...r })); db.posts.push(...rows); return { ok: true, data: rows }; }
    if (p.startsWith('/mission_artifacts')) {
      if (method === 'POST') { const row = { id: uuid(), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...body }; db.artifacts.push(row); return { ok: true, data: [row] }; }
      if (method === 'PATCH') { const id = q(p, 'id'), st = q(p, 'status'); const rows = db.artifacts.filter(a => a.id === id && (!st || a.status === st)); rows.forEach(a => Object.assign(a, body)); return { ok: true, data: rows }; }
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

const ad = (platform, o = {}) => ({ platform, framework: 'AIDA', angleName: `Angle ${platform}`, psychologicalTrigger: 'Urgency', headline: 'Short headline', body: 'Body copy that fits.', description: 'Desc', cta: 'Learn More', visualDirection: 'Bold', abHypothesis: 'CTR', ...o });
const base = { action: 'save', product: 'Custom websites for plumbers', audience: 'Plumbing business owners', objective: 'Leads', platforms: ['Meta/Facebook', 'Google Search'], projectId: PROJECT, variants: [ad('Meta/Facebook'), ad('Google Search', { cta: '' })] };

(async () => {
  const ads = load('mission-ads'), arts = load('mission-artifacts');

  console.log('\n──── save: checked before anything is kept ────');
  check('no session is refused', (await call(ads, null, base, true)).statusCode === 401);
  check('an unknown action is refused', (await call(ads, OWNER, { action: 'publish' })).statusCode === 400);
  check('no product is a question back naming the field', (await call(ads, OWNER, { ...base, product: ' ' })).body.field === 'product');
  check('no audience is a question back naming the field', (await call(ads, OWNER, { ...base, audience: '' })).body.field === 'audience');
  check('no recognised platform is refused', (await call(ads, OWNER, { ...base, platforms: ['MySpace'] })).statusCode === 400);
  check('a stranger cannot save into someone else\'s business profile', (await call(ads, STRANGER, { ...base, projectId: undefined, intelProfileId: PROFILE })).statusCode === 403);
  check('with no profile or project it stops, saying why', (await call(ads, OWNER, { ...base, projectId: undefined })).body.code === 'no_scope');
  check('no usable ads is refused', (await call(ads, OWNER, { ...base, variants: [ad('LinkedIn'), { platform: 'Meta/Facebook', headline: '', body: '' }] })).statusCode === 422);
  check('none of that saved anything', db.artifacts.length === 0);

  console.log('\n──── platform limits ────');
  const long = (n) => 'x'.repeat(n);
  const r = await call(ads, OWNER, { ...base, platforms: ['Meta/Facebook', 'Google Search', 'LinkedIn', 'Twitter/X', 'TikTok'], variants: [
    ad('Meta/Facebook'),
    ad('Meta/Facebook', { headline: long(41) }),
    ad('Meta/Facebook', { body: long(126) }),
    ad('Google Search', { headline: long(31) }),
    ad('Google Search', { description: long(91) }),
    ad('Twitter/X', { headline: '', body: long(281) }),
    ad('Twitter/X', { headline: '', body: long(280) }),
    ad('TikTok', { headline: '', body: 'ok' }),
    ad('LinkedIn', { cta: 'Buy Now' }),
    ad('Instagram'),
  ] });
  const art = db.artifacts[0];
  const v = art.payload.variants;
  check('it is saved pending approval under the ads agent', r.body.ok && art.status === 'pending_approval' && art.agent_key === 'ads' && art.kind === 'ad_campaign');
  check('an ad on a platform that was not asked for is dropped', v.length === 9 && !v.some(x => x.platform === 'Instagram'));
  check('a fitting ad has no problems', v[0].problems.length === 0);
  check('a headline over the Meta limit is flagged with the exact limit', /Headline is 41 characters — Meta\/Facebook allows 40/.test(v[1].problems[0]));
  check('primary text over 125 is flagged', /125/.test(v[2].problems[0]));
  check('Google Search headline over 30 and description over 90 are flagged', /allows 30/.test(v[3].problems[0]) && /allows 90/.test(v[4].problems[0]));
  check('X text over 280 is flagged; exactly 280 is fine', v[5].problems.length === 1 && v[6].problems.length === 0);
  check('a platform with no headline field is not asked for one', v[7].problems.length === 0);
  check('a button text that is not one of the platform\'s is a warning, not a block', v[8].problems.length === 0 && /not one of LinkedIn's call-to-action buttons/.test(v[8].warnings[0]));
  check('the result counts the usable ones', r.body.usable === 4);
  const noHeadlineGoogle = ads.checkVariant({ platform: 'Google Search', headline: '', body: 'x', description: '', cta: '' });
  check('a platform that requires a headline blocks an ad without one', noHeadlineGoogle.problems.some(p => /no headline/.test(p)));

  console.log('\n──── approve → ad copy library ────');
  db.failInsert = true;
  let a = await call(arts, OWNER, { action: 'approve', artifactId: art.id });
  check('if the save fails the approval is handed back to retry', a.statusCode === 502 && art.status === 'pending_approval' && db.posts.length === 0);
  db.failInsert = false;
  a = await call(arts, OWNER, { action: 'approve', artifactId: art.id });
  check('only the ads that fit are saved; the rest are named with the reason', a.body.result.ads === 4 && db.posts.length === 4 && a.body.result.skipped.length === 5 && /allows/.test(a.body.result.skipped[0].reason));
  const row = db.posts[0];
  check('they are saved as AD copy, never as organic posts', db.posts.every(p => p.source === 'ad' && p.metadata.ad_only === true));
  check('approved, unscheduled, nothing queued to publish', db.posts.every(p => p.status === 'approved' && !p.scheduled_at && !p.publish_status));
  check('copy, framework, angle, link description and test hypothesis are kept', row.headline === 'Short headline' && row.angle_type === 'AIDA' && row.hook === 'Angle Meta/Facebook' && row.metadata.description === 'Desc' && row.metadata.abHypothesis === 'CTR');
  check('scope and owner land correctly', row.user_id === OWNER && row.project_id === PROJECT && row.intel_profile_id === null);
  check('it can only be approved once', (await call(arts, OWNER, { action: 'approve', artifactId: art.id })).statusCode === 409 && db.posts.length === 4);
  const allBad = await call(ads, OWNER, { ...base, platforms: ['Meta/Facebook'], variants: [ad('Meta/Facebook', { headline: long(50) })] });
  const bad = db.artifacts.find(x => x.id === allBad.body.artifactId);
  check('a campaign where nothing fits cannot be approved, and stays pending', (await call(arts, OWNER, { action: 'approve', artifactId: bad.id })).statusCode === 502 && bad.status === 'pending_approval');

  console.log('\n──── the browser pipeline ────');
  const am = require(path.join(REPO, 'web/js/ads-mission.js'));
  const sp = am.sanitizeParams({ product: ' x ', audience: 'y', objective: 'Nope', platforms: ['MySpace', 'LinkedIn', 'TikTok', 'YouTube', 'Twitter/X', 'Google Search'], variants: 99 });
  check('params: unknown platforms/objectives fall back, platforms capped at 4, variants bounded', sp.objective === 'Conversions' && sp.platforms.join() === 'LinkedIn,TikTok,YouTube,Twitter/X' && sp.variants === 5 && am.sanitizeParams({}).platforms.join() === 'Meta/Facebook' && am.sanitizeParams({}).variants === 3);
  check('product and audience are both required', am.missingInputs({}).length === 2 && am.missingInputs({ product: 'p' }).length === 1 && am.missingInputs({ product: 'p', audience: 'a' }).length === 0);

  const seq = []; const bodies = [];
  const jr = (status, b) => ({ ok: status < 400, status, json: async () => b });
  function mkFetch(o = {}) {
    return async (url, init) => {
      const b = JSON.parse(init.body); bodies.push([url, b]); seq.push(url + (url === '/api/generate-ads' ? ':' + b.platforms[0] : ''));
      if (url === '/api/generate-ads') {
        if (o.fail && o.fail.has(b.platforms[0])) return jr(504, { error: `Claude took too long generating variants for ${b.platforms[0]}.` });
        return jr(200, { success: true, campaignStrategyNote: `Note ${b.platforms[0]}`, variants: [ad(b.platforms[0])] });
      }
      if (url === '/api/mission-ads') { if (o.failSave && o.failSave.n-- > 0) return jr(500, { error: 'save failed' }); } 
      if (url === '/api/mission-ads') return jr(200, { ok: true, artifactId: 'A1', status: 'pending_approval', strategyNote: b.strategyNote, variants: b.variants.map(x => ({ ...x, problems: [], warnings: [] })), failures: b.failures, usable: b.variants.length });
      throw new Error('unexpected ' + url);
    };
  }
  const headers = async () => ({ Authorization: 'Bearer t' });
  const task = { params: { product: 'Websites', audience: 'Plumbers', platforms: ['Meta/Facebook', 'LinkedIn', 'Google Search'], objective: 'Leads', variants: 3 } };
  const out = await am.runAdsCampaign(task, { authHeaders: headers, fetchImpl: mkFetch(), language: 'en-AU', projectId: PROJECT });
  check('each platform is asked for separately, in order, then the campaign is saved once', seq.join() === '/api/generate-ads:Meta/Facebook,/api/generate-ads:LinkedIn,/api/generate-ads:Google Search,/api/mission-ads');
  check('the language and brief reach each platform call', bodies[0][1].language === 'en-AU' && bodies[0][1].product === 'Websites' && bodies[0][1].variants === 3 && bodies[0][1].models.join() === 'AIDA,PAS');
  check('the campaign is complete with all the ads', out.complete && out.variants.length === 3 && out.artifactId === 'A1');
  const n = seq.length; await am.runAdsCampaign(task, { authHeaders: headers, fetchImpl: mkFetch() });
  check('re-running a finished task does not write (and pay for) a second campaign', seq.length === n);

  seq.length = 0; bodies.length = 0;
  const t2 = { params: { product: 'W', audience: 'P', platforms: ['Meta/Facebook', 'LinkedIn'] } };
  const part = await am.runAdsCampaign(t2, { authHeaders: headers, fetchImpl: mkFetch({ fail: new Set(['LinkedIn']) }) });
  check('one platform failing does not sink the others — it is reported by name', part.variants.length === 1 && part.failures.length === 1 && part.failures[0].platform === 'LinkedIn' && /too long/.test(part.failures[0].message));
  seq.length = 0;
  const t3 = { params: { product: 'W', audience: 'P', platforms: ['Meta/Facebook', 'LinkedIn'] } };
  let threw = ''; try { await am.runAdsCampaign(t3, { authHeaders: headers, fetchImpl: mkFetch({ fail: new Set(['Meta/Facebook', 'LinkedIn']) }) }); } catch (e) { threw = e.message; }
  check('every platform failing is a failed step with the reason', /No ads could be written/.test(threw) && /too long/.test(threw) && !seq.includes('/api/mission-ads'));
  seq.length = 0;
  const t4 = { params: { product: 'W', audience: 'P', platforms: ['Meta/Facebook', 'LinkedIn'] } };
  const failSave = { n: 1 };
  threw = ''; try { await am.runAdsCampaign(t4, { authHeaders: headers, fetchImpl: mkFetch({ failSave }) }); } catch (e) { threw = e.message; }
  check('a failed save is a failed step', /save failed/.test(threw));
  seq.length = 0;
  const done = await am.runAdsCampaign(t4, { authHeaders: headers, fetchImpl: mkFetch({ failSave }) });
  check('the retry only saves — the ads already written are not paid for again', seq.join() === '/api/mission-ads' && done.complete);
  seq.length = 0;
  const t5 = { params: { product: 'W', audience: 'P', platforms: ['Meta/Facebook', 'LinkedIn'] } };
  await am.runAdsCampaign(t5, { authHeaders: headers, fetchImpl: mkFetch({ fail: new Set(['Meta/Facebook', 'LinkedIn']) }) }).catch(() => {});
  seq.length = 0;
  await am.runAdsCampaign(t5, { authHeaders: headers, fetchImpl: mkFetch() });
  check('after a total failure the retry asks every platform again', seq.filter(s => s.startsWith('/api/generate-ads')).length === 2);
  threw = ''; try { await am.runAdsCampaign({ params: {} }, { authHeaders: headers, fetchImpl: mkFetch() }); } catch (e) { threw = e.message; }
  check('missing brief is refused before any request', /what is being advertised and who the audience is/.test(threw));

  console.log('\n──── Scotty ────');
  const osrc = fs.readFileSync(path.join(REPO, 'web/js/scotty-orchestrator.js'), 'utf8');
  const orch = new Function('window', 'document', `${osrc}\nreturn window.ScottyOrchestrator;`)({ AdsMission: am, localStorage: { getItem: () => null, setItem() {}, removeItem() {} } }, { readyState: 'complete', querySelectorAll: () => [], addEventListener() {} });
  check('Ads is a real executor; analytics is not', orch.isRealExecutor('ads') && !orch.isRealExecutor('analytics'));
  const txt = orch.describeAdsResult({ strategyNote: 'n', variants: [{ platform: 'Meta/Facebook', angleName: 'A', headline: 'H', body: 'b', problems: [] }, { platform: 'LinkedIn', angleName: 'B', headline: 'H2', body: 'b', problems: ['Headline is 80 characters — LinkedIn allows 70.'] }], failures: [{ platform: 'TikTok', message: 'slow' }] });
  check('the report names ads that do not fit and platforms that failed, and says nothing is bought', /does not fit/.test(txt) && /TikTok \(slow\)/.test(txt) && /nothing has been bought or published/.test(txt));

  const page = fs.readFileSync(path.join(REPO, 'web/scotty.html'), 'utf8');
  check('the page loads the module and runs it only for a task the planner marked real', /<script src="\/js\/ads-mission\.js">/.test(page) && /task\.agentKey === 'ads' && task\.realExecutor === 'ads'/.test(page));
  check('the start gate demands product and audience', /AdsMission\.missingInputs\(t\.params\)/.test(page));
  check('ad text from the model is escaped on screen', /_renderAdsResult[\s\S]*_escapeAttr\(v\.body\)[\s\S]*_escapeAttr\(v\.problems\.join/.test(page));
  check('approval says nothing is bought, scheduled or published', /Nothing is bought, scheduled or published/.test(page));
  check('the stale GPT-4o label no longer claims to power ads', !/ads:'GPT-4o'/.test(page));

  console.log('\n──── the Content Calendar keeps ad copy apart from posts ────');
  const cal = fs.readFileSync(path.join(REPO, 'web/agents/audience-agent.html'), 'utf8');
  check('ad rows are filtered out of the queue that can be scheduled (they would publish to an organic feed)', /const pending = pendingAll\.filter\(p => p\.source !== 'ad'\)/.test(cal) && /const approved = approvedAll\.filter\(p => p\.source !== 'ad'\)/.test(cal));
  check('approved ad copy has its own list', /id="calendar-ads-body"/.test(cal) && /renderAdCopy\(approvedAll\.filter\(p => p\.source === 'ad'\)\)/.test(cal));
  check('the ad list offers copy-out and escapes everything it shows', /AM\.copyAd\(this\)/.test(cal) && /copyAd, setPostSchedule/.test(cal) && /escHtml\(p\.body\)/.test(cal) && /data-copy="\$\{escHtml\(text\)\}"/.test(cal));

  console.log(failures === 0 ? '\nALL ASSERTIONS PASSED\n' : `\n${failures} FAILED\n`);
  process.exit(failures === 0 ? 0 : 1);
})();
