/**
 * Pat as a real Scotty executor: api/_lib/pat-pipeline.js, api/mission-pat.js,
 * the pat_campaign approve path in api/mission-artifacts.js, the cleanup
 * agent's needs_input case, and Scotty's orchestrator/page wiring.
 *
 *   node tests/mission-pat/run.js
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
function mockModule(relPath, exportsObj) {
  const p = require.resolve(path.join(REPO, relPath));
  require.cache[p] = { id: p, filename: p, loaded: true, exports: exportsObj };
}

const OWNER = '11111111-1111-1111-1111-111111111111';
const STRANGER = '44444444-4444-4444-4444-444444444444';
const PROFILE = '55555555-5555-5555-5555-555555555555';

const db = { artifacts: [], segments: [], profiles: [{ id: PROFILE, owner_id: OWNER }], failSegment: false };
let nextId = 1;
const uuid = () => `bbbbbbbb-bbbb-bbbb-bbbb-${String(nextId++).padStart(12, '0')}`;
const q = (s, key) => { const m = s.match(new RegExp(`[?&]${key}=eq\\.([^&]+)`)); return m ? decodeURIComponent(m[1]) : null; };

mockModule('api/_lib/supabase-rest.js', {
  isUuid: (v) => /^[0-9a-f-]{36}$/i.test(String(v)),
  sbRest: async (url, key, method, p, body) => {
    if (p.startsWith('/intelligence_profiles')) {
      const id = q(p, 'id'), owner = q(p, 'owner_id');
      return { ok: true, data: db.profiles.filter(x => (!id || x.id === id) && (!owner || x.owner_id === owner)) };
    }
    if (p.startsWith('/intelligence_profile_members')) return { ok: true, data: [] };
    if (p.startsWith('/segments')) {
      if (db.failSegment) return { ok: false, status: 500, data: null };
      if (method === 'POST') { const row = { id: uuid(), ...body }; db.segments.push(row); return { ok: true, data: [row] }; }
      const name = q(p, 'name'), uid = q(p, 'user_id');
      return { ok: true, data: db.segments.filter(s => s.name === name && s.user_id === uid) };
    }
    if (p.startsWith('/mission_artifacts')) {
      if (method === 'POST') { const row = { id: uuid(), created_at: new Date().toISOString(), ...body }; db.artifacts.push(row); return { ok: true, data: [row] }; }
      if (method === 'PATCH') {
        const id = q(p, 'id'), status = q(p, 'status');
        const rows = db.artifacts.filter(a => a.id === id && (!status || a.status === status));
        rows.forEach(a => Object.assign(a, body));
        return { ok: true, data: rows };
      }
      const id = q(p, 'id');
      return { ok: true, data: db.artifacts.filter(a => a.id === id) };
    }
    return { ok: true, data: [] };
  },
});
mockModule('api/_lib/rate-limit.js', { rateLimited: () => false });
mockModule('api/_lib/report-failure.js', { withFailureReporting: (n, h) => h, reportFailureAsync() {}, reportFailure() {} });

let drafts = 0;
let draftResult = { status: 'drafted', subject: 'Quick question', html: '<p>Hi {{firstName}},</p>', text: 'Hi', review: { approved: true, blockers: [], warnings: [], summary: 'ok' }, fixed: false, questions: [], preview: { subject: 'Quick question', html: '<p>Hi Sam,</p>' } };
let lastInput = null;
mockModule('api/_lib/pat-pipeline.js', { buildCampaign: async (input) => { drafts++; lastInput = input; if (draftResult.status === 'needs_input') return draftResult; return draftResult; } });

global.fetch = async (url) => (String(url).includes('/auth/v1/user') && global.__callerId) ? { ok: true, json: async () => ({ id: global.__callerId }) } : { ok: false };
process.env.SUPABASE_URL = 'https://x.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc';
process.env.ANTHROPIC_API_KEY = 'k';

function load(name) { const p = path.join(REPO, `api/${name}.js`); delete require.cache[require.resolve(p)]; return require(p); }
function makeRes() { const r = { statusCode: 200 }; r.status = (c) => { r.statusCode = c; return r; }; r.json = (d) => { r.body = d; return r; }; r.setHeader = () => {}; r.end = () => r; return r; }
async function call(h, callerId, body, noAuth) { global.__callerId = callerId; const r = makeRes(); await h({ method: 'POST', headers: noAuth ? {} : { authorization: 'Bearer t' }, body }, r); return r; }

(async () => {
  const pat = load('mission-pat');
  const arts = load('mission-artifacts');
  const offer = { action: 'draft', offer: 'A free homepage redesign preview', audience: 'plumbers', audienceTags: ['Blade-Prospect', 'plumbers'], companyName: 'Webese' };

  console.log('\n──── mission-pat: access and input ────');
  check('no session is refused', (await call(pat, null, offer, true)).statusCode === 401);
  check('an unknown action is refused', (await call(pat, OWNER, { action: 'send' })).statusCode === 400);
  check('a stranger cannot draft into someone else\'s profile', (await call(pat, STRANGER, { ...offer, intelProfileId: PROFILE })).statusCode === 403);
  check('nothing was drafted or saved for those', drafts === 0 && db.artifacts.length === 0);

  draftResult = { status: 'needs_input', questions: [{ field: 'offer', question: 'What are you offering?' }] };
  const asked = await call(pat, OWNER, { action: 'draft', offer: '' });
  check('a missing fact comes back as questions', asked.body.status === 'needs_input' && asked.body.questions.length === 1);
  check('and creates no artifact', db.artifacts.length === 0);

  console.log('\n──── mission-pat: a draft becomes an approvable artifact ────');
  draftResult = { status: 'drafted', subject: 'Quick question', html: '<p>Hi {{firstName}},</p>', text: 'Hi', review: { approved: true, blockers: [], warnings: [], summary: 'ok' }, fixed: false, questions: [], preview: { subject: 'Quick question', html: '<p>Hi Sam,</p>' } };
  const ok = await call(pat, OWNER, { ...offer, ctaUrl: 'javascript:alert(1)', expectedRecipients: 12 });
  const art = db.artifacts[0];
  check('a draft is saved pending approval under agent delivery', ok.body.status === 'drafted' && art.status === 'pending_approval' && art.agent_key === 'delivery' && art.kind === 'pat_campaign');
  check('a non-http link is dropped before it reaches the drafter', lastInput.ctaUrl === '');
  check('audience tags are normalised to slugs', JSON.stringify(art.payload.params.audienceTags) === JSON.stringify(['blade-prospect', 'plumbers']));
  check('the copy with its merge tags is kept for sending', art.payload.html.includes('{{firstName}}'));

  console.log('\n──── approve: only a draft that passed review, and it sends nothing ────');
  let sent = 0; const realFetch = global.fetch;
  global.fetch = async (u, ...a) => { if (/resend|send-campaign/.test(String(u))) sent++; return realFetch(u, ...a); };
  const good = await call(arts, OWNER, { action: 'approve', artifactId: art.id });
  check('approval succeeds and reports the prepared segment', good.body.ok && good.body.result.segmentId && db.segments.length === 1);
  check('the segment is dynamic, subscribed, all-tags', db.segments[0].member_mode === 'dynamic' && db.segments[0].filter_rules.status === 'subscribed' && db.segments[0].filter_rules.tagsAll.includes('blade-prospect'));
  check('nothing was sent', sent === 0);
  check('it can only be approved once', (await call(arts, OWNER, { action: 'approve', artifactId: art.id })).statusCode === 409);

  draftResult = { ...draftResult, review: { approved: false, blockers: ['Contains [Name] placeholder'], warnings: [], summary: '' } };
  await call(pat, OWNER, offer);
  const bad = db.artifacts[1];
  const refused = await call(arts, OWNER, { action: 'approve', artifactId: bad.id });
  check('a draft that failed review cannot be approved', refused.statusCode === 409 && refused.body.blockers[0].includes('[Name]'));
  check('and stays pending, undecided', bad.status === 'pending_approval' && !bad.decided_at);
  check('it can still be rejected', (await call(arts, OWNER, { action: 'reject', artifactId: bad.id })).body.status === 'rejected');

  draftResult = { ...draftResult, review: { approved: true, blockers: [], warnings: [], summary: 'ok' } };
  await call(pat, OWNER, offer);
  const third = db.artifacts[2];
  db.failSegment = true;
  const failed = await call(arts, OWNER, { action: 'approve', artifactId: third.id });
  check('if the audience cannot be prepared the approval is handed back to retry', failed.statusCode === 502 && third.status === 'pending_approval');
  db.failSegment = false;
  const retried = await call(arts, OWNER, { action: 'approve', artifactId: third.id });
  check('retry succeeds and reuses the existing segment', retried.body.ok && db.segments.length === 1);

  console.log('\n──── cleanup agent: a stuck draft is reported ────');
  const { assess } = load('cron-mission-cleanup');
  const NOW = Date.now();
  const stuck = assess({ id: 'x', title: 'T', status: 'pending_approval', kind: 'pat_campaign', updated_at: new Date(NOW).toISOString(), payload: { review: { approved: false, blockers: ['b'] } } }, NOW);
  check('an unapprovable draft is flagged needs_input', stuck && stuck.reason === 'needs_input');
  check('a passing draft is healthy', assess({ id: 'x', title: 'T', status: 'pending_approval', kind: 'pat_campaign', updated_at: new Date(NOW).toISOString(), payload: { review: { approved: true } } }, NOW) === null);

  console.log('\n──── pat-pipeline: gates, one fix round, honest failure ────');
  delete require.cache[require.resolve(path.join(REPO, 'api/_lib/pat-pipeline.js'))];   // drop the mock; test the real module
  const { buildCampaign } = require(path.join(REPO, 'api/_lib/pat-pipeline.js'));
  const goodCopy = { subject: 'Quick question about your site', html: '<p>Hi {{firstName}},</p><p>We build custom sites for trades. Reply if curious.</p><p>Sam, Webese</p>', text: 'Hi {{firstName}}, we build custom sites for trades. Reply if curious. Sam, Webese' };
  const approvedReview = async () => ({ approved: true, blockers: [], warnings: [], summary: 'fine' });
  let calls = { draft: 0, review: 0, fix: 0 };
  const deps = (o) => ({ draft: async () => { calls.draft++; return o.copy || goodCopy; }, review: async (a) => { calls.review++; return (o.review || approvedReview)(a); }, fix: async (a) => { calls.fix++; return o.fix(a); } });

  let r = await buildCampaign({ offer: '', senderName: 'Sam' }, deps({}));
  check('no offer = questions, and no model call is made', r.status === 'needs_input' && calls.draft === 0);
  r = await buildCampaign({ offer: 'Free preview' }, deps({}));
  check('no sender or company = a question, not an invented signature', r.status === 'needs_input' && r.questions[0].field === 'sender' && calls.draft === 0);

  r = await buildCampaign({ offer: 'Free preview', senderName: 'Sam' }, deps({}));
  check('a clean draft passes with no fix round', r.status === 'drafted' && r.review.approved && !r.fixed && calls.fix === 0);
  check('the preview fills merge tags with a sample', r.preview.html.includes('Hi Sam,'));

  calls = { draft: 0, review: 0, fix: 0 };
  r = await buildCampaign({ offer: 'Free preview', senderName: 'Sam' }, deps({ copy: { ...goodCopy, html: '<p>Hi [Name],</p>' } }));
  check('a bracket placeholder is blocked by the deterministic gate even if the reviewer approves', !r.review.approved && r.review.blockers.some(b => /placeholder|\[/i.test(b)));

  calls = { draft: 0, review: 0, fix: 0 };
  r = await buildCampaign({ offer: 'Free preview', senderName: 'Sam' }, deps({ copy: { ...goodCopy, html: '<p>Hi {{nickname}},</p>' } }));
  check('an unknown merge tag is blocked', !r.review.approved && r.review.blockers.some(b => /nickname/.test(b)));

  calls = { draft: 0, review: 0, fix: 0 };
  r = await buildCampaign({ offer: 'Free preview', senderName: 'Sam' }, deps({
    copy: { ...goodCopy, html: '<p>Hi [Name],</p>' },
    fix: async () => ({ fixedSubject: goodCopy.subject, fixedHtml: goodCopy.html, fixedText: goodCopy.text, questions: [] }),
  }));
  check('one fix round repairs it and re-checks', r.fixed && r.review.approved && calls.fix === 1);

  calls = { draft: 0, review: 0, fix: 0 };
  r = await buildCampaign({ offer: 'Free preview', senderName: 'Sam' }, deps({ review: async () => { throw new Error('model down'); } }));
  check('a review that could not run is NOT a pass', !r.review.approved && r.review.blockers.some(b => /could not run/.test(b)));
  check('and no fix is attempted blind', calls.fix === 0);

  console.log('\n──── Scotty: orchestrator and page ────');
  const osrc = fs.readFileSync(path.join(REPO, 'web/js/scotty-orchestrator.js'), 'utf8');
  const orch = new Function('window', 'document', `${osrc}\nreturn window.ScottyOrchestrator;`)(
    { localStorage: { getItem: () => null, setItem() {}, removeItem() {} } },
    { readyState: 'complete', querySelectorAll: () => [], addEventListener: () => {} });
  check('Pat is a real executor', orch.isRealExecutor('delivery') === true);
  check('params are sanitised: non-http link dropped, tags slugged', (() => { const p = orch.sanitizePatParams({ offer: ' x ', ctaUrl: 'javascript:1', audienceTags: ['Blade Prospect'] }); return p.ctaUrl === '' && p.audienceTags[0] === 'blade-prospect'; })());
  check('a missing offer is reported', orch.missingPatInputs({}).length === 1 && orch.missingPatInputs({ offer: 'x' }).length === 0);
  const headers = async () => ({ Authorization: 'Bearer t' });
  const jr = (status, body) => ({ ok: status < 400, status, json: async () => body });
  let fetches = 0;
  const task = { params: { offer: 'Free preview', audienceTags: [] } };
  const out = await orch.runPatTask(task, { authHeaders: headers, fetchImpl: async () => { fetches++; return jr(200, { status: 'drafted', artifactId: 'a1', subject: 'S', html: '<p>x</p>', text: 'x', preview: {}, review: { approved: true, blockers: [] } }); } });
  check('a draft is returned with its artifact', out.artifactId === 'a1' && out.html === '<p>x</p>');
  await orch.runPatTask(task, { authHeaders: headers, fetchImpl: async () => { fetches++; return jr(200, {}); } });
  check('a retry does not draft (and pay) twice', fetches === 1);
  let threw = '';
  try { await orch.runPatTask({ params: { offer: 'x' } }, { authHeaders: headers, fetchImpl: async () => jr(200, { status: 'needs_input', questions: [{ question: 'Who is it from?' }] }) }); } catch (e) { threw = e.message; }
  check('questions from the server surface as a failure, not a made-up draft', /Who is it from/.test(threw));
  try { await orch.runPatTask({ params: {} }, { authHeaders: headers, fetchImpl: async () => jr(200, {}) }); threw = ''; } catch (e) { threw = e.message; }
  check('no offer = refused before any request', /offering/.test(threw));
  check('a failed review is described plainly, with blockers', /did \*\*not\*\* pass/.test(orch.describePatResult({ subject: 'S', review: { approved: false, blockers: ['bad link'] }, questions: [] })));

  const page = fs.readFileSync(path.join(REPO, 'web/scotty.html'), 'utf8');
  check('the page previews the draft in a sandboxed, script-free iframe', /<iframe sandbox=""[^>]*srcdoc="\$\{this\._escapeAttr\(/.test(page));
  check('approval offers a hand-off to Pat, never a send', /Open in Pat to send/.test(page) && !/api\/send-campaign/.test(page.split('_renderPatResult')[1].slice(0, 6000)));
  check('Approve is only rendered for a draft that passed review', /\$\{r\.approved\s*\?/.test(page));

  console.log(failures === 0 ? '\nALL ASSERTIONS PASSED\n' : `\n${failures} FAILED\n`);
  process.exit(failures === 0 ? 0 : 1);
})();
