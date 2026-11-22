/**
 * Chase as a real Scotty executor: the shared audit pipeline, api/mission-chase.js,
 * the chase_audit approve path (opportunity tags on existing contacts), the
 * cleanup agent's view of it, and Scotty's orchestrator/page wiring.
 *
 *   node tests/mission-chase/run.js
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
const db = { artifacts: [], contacts: [], failContactLookup: false, failPatch: new Set() };
let nextId = 1; const uuid = () => `cccccccc-cccc-cccc-cccc-${String(nextId++).padStart(12, '0')}`;
const q = (s, k) => { const m = s.match(new RegExp(`[?&]${k}=eq\\.([^&]+)`)); return m ? decodeURIComponent(m[1]) : null; };

mockModule('api/_lib/supabase-rest.js', {
  isUuid: (v) => /^[0-9a-f-]{36}$/i.test(String(v)),
  sbRest: async (u, k, method, p, body) => {
    if (p.startsWith('/intelligence_profiles')) return { ok: true, data: [] };
    if (p.startsWith('/intelligence_profile_members')) return { ok: true, data: [] };
    if (p.startsWith('/mission_artifacts')) {
      if (method === 'POST') { const row = { id: uuid(), created_at: new Date().toISOString(), ...body }; db.artifacts.push(row); return { ok: true, data: [row] }; }
      if (method === 'PATCH') {
        const id = q(p, 'id'), status = q(p, 'status');
        const rows = db.artifacts.filter(a => a.id === id && (!status || a.status === status));
        rows.forEach(a => Object.assign(a, body)); return { ok: true, data: rows };
      }
      return { ok: true, data: db.artifacts.filter(a => a.id === q(p, 'id')) };
    }
    if (p.startsWith('/contacts')) {
      if (method === 'PATCH') {
        const id = q(p, 'id');
        if (db.failPatch.has(id)) return { ok: false, status: 500 };
        const c = db.contacts.find(x => x.id === id && x.user_id === q(p, 'user_id')); Object.assign(c, body); return { ok: true, data: [c] };
      }
      if (db.failContactLookup) return { ok: false, status: 500 };
      const inm = p.match(/email=in\.\(([^)]*)\)/); const emails = inm ? inm[1].split(',').map(decodeURIComponent) : [];
      return { ok: true, data: db.contacts.filter(c => c.user_id === q(p, 'user_id') && emails.includes(c.email)) };
    }
    return { ok: true, data: [] };
  },
});
mockModule('api/_lib/rate-limit.js', { rateLimited: () => false });
mockModule('api/_lib/report-failure.js', { withFailureReporting: (n, h) => h, reportFailureAsync() {}, reportFailure() {} });

const audits = {};
let auditCalls = [];
mockModule('api/_lib/website-audit.js', {
  auditWebsite: async (url) => {
    auditCalls.push(url);
    if (audits[url] === 'throw') throw new Error('crawl exploded');
    return audits[url] || { checkedAt: 'now', scores: { performance: 40, mobile: 50, seo: 30, localSeo: 20, conversion: 30, content: 40 },
      problems: [{ issue: 'Low issue', severity: 'low', evidence: 'e' }, { issue: 'Big issue', severity: 'high', evidence: 'e2' }, { issue: 'Mid', severity: 'medium', evidence: 'e3' }, { issue: 'Another low', severity: 'low', evidence: 'e4' }], brandColors: null, raw: {} };
  },
});
mockModule('api/_lib/tech-detect.js', { detectTechnology: async (url) => ({ available: true, checked: true, technologies: url.includes('wix') ? [{ name: 'Wix', category: 'website-builder' }] : [] }) });

global.fetch = async (url) => (String(url).includes('/auth/v1/user') && global.__callerId) ? { ok: true, json: async () => ({ id: global.__callerId }) } : { ok: false };
Object.assign(process.env, { SUPABASE_URL: 'https://x.test', SUPABASE_SERVICE_ROLE_KEY: 'svc' });
function load(n) { const p = path.join(REPO, `api/${n}.js`); delete require.cache[require.resolve(p)]; return require(p); }
function res() { const r = { statusCode: 200 }; r.status = (c) => { r.statusCode = c; return r; }; r.json = (d) => { r.body = d; return r; }; r.setHeader = () => {}; r.end = () => r; return r; }
async function call(h, who, body, noAuth) { global.__callerId = who; const r = res(); await h({ method: 'POST', headers: noAuth ? {} : { authorization: 'Bearer t' }, body }, r); return r; }

const blade = (status = 'pending_approval', user = OWNER) => {
  const a = { id: uuid(), user_id: user, kind: 'blade_leads', status, title: 'plumbers in Austin', payload: { params: { sector: 'plumbers' }, leads: [
    { placeId: 'p1', name: 'Wix Plumbing', website: 'https://wix-plumbing.example', email: 'a@wix.example', rating: 4.5, reviewCount: 30, phone: '1' },
    { placeId: 'p2', name: 'No Site Plumbing', website: '', email: null },
    { placeId: 'p3', name: 'Plain Plumbing', website: 'https://plain.example', email: 'b@plain.example' },
  ] } };
  db.artifacts.push(a); return a;
};

(async () => {
  const chase = load('mission-chase'), arts = load('mission-artifacts');

  console.log('\n──── start: access and sources ────');
  check('no session is refused', (await call(chase, null, { action: 'start', urls: ['a.com'] }, true)).statusCode === 401);
  check('nothing to audit is a clear 400', (await call(chase, OWNER, { action: 'start' })).statusCode === 400);
  check('junk addresses are dropped, and a list of only junk is refused', (await call(chase, OWNER, { action: 'start', urls: ['javascript:alert(1)', 'ftp://x.com', 'nodots', ''] })).statusCode === 400);
  const building = blade('building');
  check('a Blade list still being built cannot be audited yet', (await call(chase, OWNER, { action: 'start', sourceArtifactId: building.id })).statusCode === 409);
  check('someone else\'s Blade list is not found', (await call(chase, STRANGER, { action: 'start', sourceArtifactId: blade().id })).statusCode === 404);
  check('a rejected Blade list is refused', (await call(chase, OWNER, { action: 'start', sourceArtifactId: blade('rejected').id })).statusCode === 409);
  check('none of those created an artifact', db.artifacts.filter(a => a.kind === 'chase_audit').length === 0);

  console.log('\n──── start from a Blade list, then audit in batches ────');
  const src = blade();
  let r = await call(chase, OWNER, { action: 'start', sourceArtifactId: src.id });
  const art = db.artifacts.find(a => a.id === r.body.artifactId);
  check('the businesses with a website become the list; the one without is counted, not audited', r.body.leads.length === 2 && art.payload.source.noWebsite === 1);
  check('the artifact is building under the chase agent', art.status === 'building' && art.agent_key === 'chase' && art.kind === 'chase_audit');
  check('the trade carries over as the industry', art.payload.params.industry === 'plumbers');
  check('nothing has been audited yet (no crawl spent on start)', auditCalls.length === 0);

  r = await call(chase, OWNER, { action: 'audit', artifactId: art.id, batchSize: 1 });
  check('a batch audits only what was asked', r.body.processed === 1 && r.body.remaining === 1 && auditCalls.length === 1 && art.status === 'building');
  check('it cannot be approved while still building', (await call(arts, OWNER, { action: 'approve', artifactId: art.id })).statusCode === 409);
  r = await call(chase, OWNER, { action: 'audit', artifactId: art.id });
  check('the last batch flips it to pending approval', r.body.remaining === 0 && art.status === 'pending_approval');
  const wix = art.payload.leads.find(l => l.name === 'Wix Plumbing');
  check('the builder is detected and flagged as a target platform', wix.audit.platform === 'Wix' && wix.audit.isTargetPlatform === true);
  check('the biggest problems come first, capped at three', wix.audit.topProblems.length === 3 && wix.audit.topProblems[0].issue === 'Big issue');
  check('the score and classification are kept', typeof wix.audit.opportunity.score === 'number' && !!wix.audit.opportunity.classification);
  check('an audit of a finished list is refused', (await call(chase, OWNER, { action: 'audit', artifactId: art.id })).statusCode === 409);
  check('a stranger cannot audit into it', (await call(chase, STRANGER, { action: 'audit', artifactId: art.id })).statusCode === 404);

  console.log('\n──── a failed crawl is a failure, not a low score ────');
  audits['https://boom.example/'] = 'throw';
  audits['https://dead.example/'] = { checkedAt: 'n', scores: { performance: null, mobile: null, seo: null, localSeo: null, conversion: null, content: null, _missing: ['performance', 'mobile', 'seo', 'localSeo', 'conversion', 'content'] }, problems: [{ issue: 'Site could not be crawled' }], brandColors: null, raw: {} };
  r = await call(chase, OWNER, { action: 'start', urls: ['boom.example', 'dead.example', 'http://www.good.example', 'good.example'] });
  const art2 = db.artifacts.find(a => a.id === r.body.artifactId);
  check('typed addresses are normalised and de-duplicated by host', r.body.leads.length === 3);
  await call(chase, OWNER, { action: 'audit', artifactId: art2.id });
  const [boom, dead, good] = ['boom.example', 'dead.example', 'good.example'].map(h => art2.payload.leads.find(l => l.name.includes(h)));
  check('a crawl that throws records the error and no score', !!boom.auditError && boom.audit === null);
  check('a site that could not be crawled at all is an error, never a zero score', !!dead.auditError && dead.audit === null);
  check('the others still get scored', !!good.audit && !good.auditError);
  check('the audit completes (a failed site does not wedge the list)', art2.status === 'pending_approval');

  console.log('\n──── the cap ────');
  r = await call(chase, OWNER, { action: 'start', urls: Array.from({ length: 40 }, (_, i) => `s${i}.example`) });
  check('a mission audits at most 25 sites and says so', r.body.leads.length === 25 && r.body.truncated === true);

  console.log('\n──── approve: tags existing prospects, nothing else ────');
  db.contacts = [
    { id: 'k1', user_id: OWNER, email: 'a@wix.example', tags: ['blade-prospect', 'plumbers', 'opportunity-low-priority'], custom_fields: { website: 'x' } },
    { id: 'k2', user_id: STRANGER, email: 'b@plain.example', tags: [], custom_fields: {} },
  ];
  const before = JSON.stringify(db.contacts[1]);
  r = await call(arts, OWNER, { action: 'approve', artifactId: art.id });
  check('approval reports what it did', r.body.ok && r.body.result.tagged === 1);
  check('a prospect not in this account\'s audience is counted, never created', r.body.result.notInAudience === 1 && db.contacts.length === 2);
  const k1 = db.contacts[0];
  check('the opportunity tag replaces an earlier one and keeps the rest', k1.tags.includes('blade-prospect') && k1.tags.includes('plumbers') && !k1.tags.includes('opportunity-low-priority') && k1.tags.filter(t => t.startsWith('opportunity-')).length === 1);
  check('the score and platform are recorded without losing existing fields', k1.custom_fields.website === 'x' && typeof k1.custom_fields.opportunity_score === 'number' && k1.custom_fields.site_platform === 'Wix');
  check('another account\'s contact with a matching email is untouched', JSON.stringify(db.contacts[1]) === before);
  check('it can only be approved once', (await call(arts, OWNER, { action: 'approve', artifactId: art.id })).statusCode === 409);

  const art3 = (() => { const a = { id: uuid(), user_id: OWNER, kind: 'chase_audit', status: 'pending_approval', title: 't', payload: { leads: [{ name: 'A', email: 'a@wix.example', audited: true, audit: { platform: null, checkedAt: 'x', opportunity: { score: 85, classification: 'high_priority' } } }] } }; db.artifacts.push(a); return a; })();
  db.failContactLookup = true;
  r = await call(arts, OWNER, { action: 'approve', artifactId: art3.id });
  check('if the audience cannot be read the approval is handed back to retry', r.statusCode === 502 && art3.status === 'pending_approval');
  db.failContactLookup = false; db.failPatch.add('k1');
  r = await call(arts, OWNER, { action: 'approve', artifactId: art3.id });
  check('a contact that fails to save is named, counted, and the rest are not blocked', r.body.result.failed === 1 && r.body.result.failedLeads[0].email === 'a@wix.example');
  check('the summary counts audited leads', (await call(arts, OWNER, { action: 'get', artifactId: art.id })).body.artifact.counts.audited === 2);

  console.log('\n──── cleanup agent ────');
  const { assess } = load('cron-mission-cleanup');
  const NOW = Date.now(); const ago = (m) => new Date(NOW - m * 60000).toISOString();
  check('a stalled audit is flagged, counting unaudited leads', /1 of 2 leads never finished/.test(assess({ id: 'x', title: 'T', status: 'building', updated_at: ago(45), payload: { leads: [{ audited: true }, { audited: false }] } }, NOW).message));
  check('finished audits with a failed site are surfaced for retry', assess({ id: 'x', title: 'T', status: 'pending_approval', kind: 'chase_audit', updated_at: ago(1), payload: { leads: [{ name: 'A', auditError: 'boom' }] } }, NOW).reason === 'lookup_errors');
  check('failed tagging after approval is reported like a failed import', assess({ id: 'x', title: 'T', status: 'approved', updated_at: ago(1), payload: { approval: { tagged: 3, failed: 1 } } }, NOW).reason === 'import_failed');

  console.log('\n──── Scotty ────');
  const osrc = fs.readFileSync(path.join(REPO, 'web/js/scotty-orchestrator.js'), 'utf8');
  const orch = new Function('window', 'document', `${osrc}\nreturn window.ScottyOrchestrator;`)({ localStorage: { getItem: () => null, setItem() {}, removeItem() {} } }, { readyState: 'complete', querySelectorAll: () => [], addEventListener() {} });
  check('Chase is a registered, real executor', orch.isRealExecutor('chase') && orch.AGENT_ROUTES.chase === '/agents/sales-agent.html');
  check('the generic sales agent is still not real — it covers far more than audits', orch.isRealExecutor('sales') === false);
  check('pipeline order is Blade → Chase → Pat whatever order the model listed them in', orch.orderForExecution(['delivery', 'email', 'chase', 'blade', 'seo']).join() === 'blade,email,chase,delivery,seo');
  check('ordering leaves a mission without real executors alone and drops duplicates', orch.orderForExecution(['seo', 'email', 'seo']).join() === 'seo,email');
  check('params: addresses are split, de-duplicated and capped', (() => { const p = orch.sanitizeChaseParams({ urls: 'a.com, b.com\na.com' }); return p.urls.join() === 'a.com,b.com'; })());
  check('with Blade earlier in the mission, no addresses are needed', orch.missingChaseInputs({}, { hasBladeSource: true }).length === 0);
  check('without Blade, addresses are required', orch.missingChaseInputs({}, {}).length === 1);

  const jr = (status, body) => ({ ok: status < 400, status, json: async () => body });
  const headers = async () => ({ Authorization: 'Bearer t' });
  const calls = [];
  const fetchImpl = async (u, o) => {
    const b = JSON.parse(o.body); calls.push(b);
    if (b.action === 'start') return jr(200, { artifactId: 'a1', status: 'building', source: {}, leads: [{ key: 'k1', name: 'A' }, { key: 'k2', name: 'B' }], remaining: 2 });
    return jr(200, { processed: 1, remaining: calls.filter(c => c.action === 'audit').length >= 2 ? 0 : 1, status: calls.filter(c => c.action === 'audit').length >= 2 ? 'pending_approval' : 'building', leads: [{ key: calls.filter(c => c.action === 'audit').length === 1 ? 'k1' : 'k2', name: 'x', audited: true, audit: { opportunity: { score: 70, classification: 'strong_prospect' }, topProblems: [], platform: null } }] });
  };
  const task = { params: {} };
  const done = await orch.runChaseTask(task, { authHeaders: headers, sourceArtifactId: 'blade1', fetchImpl });
  check('it starts from the Blade list, then audits in batches until none remain', calls[0].sourceArtifactId === 'blade1' && calls.filter(c => c.action === 'audit').length === 2 && done.complete && done.status === 'pending_approval');
  const n = calls.length; await orch.runChaseTask(task, { authHeaders: headers, sourceArtifactId: 'blade1', fetchImpl });
  check('a retry resumes instead of starting (and paying) again', calls.length === n);
  let threw = ''; try { await orch.runChaseTask({ params: {} }, { authHeaders: headers, fetchImpl }); } catch (e) { threw = e.message; }
  check('no Blade list and no addresses is refused before any request', /website addresses/.test(threw));
  threw = ''; try { await orch.runChaseTask({ params: {} }, { authHeaders: headers, sourceArtifactId: 'b', fetchImpl: async (u, o) => JSON.parse(o.body).action === 'start' ? jr(200, { artifactId: 'a', leads: [{ key: 'k' }], remaining: 1 }) : jr(200, { processed: 0, remaining: 1 }) }); } catch (e) { threw = e.message; }
  check('an audit that stops advancing is a failed task, not a finished one', /stalled/.test(threw));
  check('the report mentions failures and what is waiting', /could not be audited/.test(orch.describeChaseResult({ leads: [{ name: 'A', audit: { platform: 'Wix', opportunity: { score: 80, classification: 'high_priority' }, topProblems: [{ issue: 'x' }] } }, { name: 'B', auditError: 'x' }] })) && /Waiting for your approval/.test(orch.describeChaseResult({ leads: [{ name: 'A', audit: { platform: null, opportunity: { score: 1, classification: 'x' }, topProblems: [] } }] })));

  const page = fs.readFileSync(path.join(REPO, 'web/scotty.html'), 'utf8');
  check('the page runs Chase with the finished Blade list', /orch\.runChaseTask\(task/.test(page) && /sourceArtifactId: bladeArtifactId/.test(page));
  check('the start gate demands addresses when the mission has no Blade step', /missingChaseInputs\(t\.params, \{ hasBladeSource: hasBlade \}\)/.test(page));
  check('business names and problems from the web are escaped, not injected', /_renderChaseResult[\s\S]*_escapeAttr\(l\.name\)[\s\S]*_escapeAttr\(l\.auditError\)/.test(page));
  check('approval is explicit and says nothing is sent', /Approve — tag prospects by opportunity/.test(page) && /It changes nothing else and sends nothing/.test(page));

  console.log(failures === 0 ? '\nALL ASSERTIONS PASSED\n' : `\n${failures} FAILED\n`);
  process.exit(failures === 0 ? 0 : 1);
})();
