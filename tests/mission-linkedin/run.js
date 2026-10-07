/**
 * LinkedIn Outreach as a real Scotty executor: draft checks
 * (api/_lib/linkedin-drafts.js), api/mission-linkedin.js, the approve path,
 * the browser module that files approved drafts on the prospect list, and the
 * page. Nothing in the flow may send anything or touch LinkedIn.
 *
 *   node tests/mission-linkedin/run.js
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
const db = { artifacts: [], projects: [{ id: PROJECT, user_id: OWNER }] };
let nextId = 1; const uuid = () => `bcbcbcbc-bcbc-bcbc-bcbc-${String(nextId++).padStart(12, '0')}`;
const q = (s, k) => { const m = s.match(new RegExp(`[?&]${k}=eq\\.([^&]+)`)); return m ? decodeURIComponent(m[1]) : null; };
mockModule('api/_lib/supabase-rest.js', {
  isUuid: (v) => /^[0-9a-f-]{36}$/i.test(String(v)),
  sbRest: async (u, k, method, p, body) => {
    if (p.startsWith('/intelligence_profiles')) { const id = q(p, 'id'), o = q(p, 'owner_id'); return { ok: true, data: [{ id: PROFILE, owner_id: OWNER }].filter(x => (!id || x.id === id) && (!o || x.owner_id === o)) }; }
    if (p.startsWith('/intelligence_profile_members')) return { ok: true, data: [] };
    if (p.startsWith('/projects')) return { ok: true, data: db.projects.filter(x => x.id === q(p, 'id') && x.user_id === q(p, 'user_id')) };
    if (p.startsWith('/mission_artifacts')) {
      if (method === 'POST') { const row = { id: uuid(), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...body }; db.artifacts.push(row); return { ok: true, data: [row] }; }
      if (method === 'PATCH') { const id = q(p, 'id'), st = q(p, 'status'); const rows = db.artifacts.filter(a => a.id === id && (!st || a.status === st)); rows.forEach(a => Object.assign(a, body)); return { ok: true, data: rows }; }
      return { ok: true, data: JSON.parse(JSON.stringify(db.artifacts.filter(a => a.id === q(p, 'id')))) };
    }
    return { ok: true, data: [] };
  },
});
mockModule('api/_lib/rate-limit.js', { rateLimited: () => false });
mockModule('api/_lib/report-failure.js', { withFailureReporting: (n, h) => h, reportFailureAsync() {}, reportFailure() {} });
let claudeCalls = []; let writeImpl;
mockModule('api/_lib/nancy-claude.js', { callClaudeForJSON: async (a) => { claudeCalls.push(a); const d = writeImpl(a); return d instanceof Error ? { success: false, error: d.message } : { success: true, data: d }; }, asUntrustedContent: (t) => t, UNTRUSTED_CONTENT_RULE: '' });
let fetched = [];
global.fetch = async (url) => { fetched.push(String(url)); return (String(url).includes('/auth/v1/user') && global.__callerId) ? { ok: true, json: async () => ({ id: global.__callerId }) } : { ok: false }; };
Object.assign(process.env, { SUPABASE_URL: 'https://x.test', SUPABASE_SERVICE_ROLE_KEY: 'svc', ANTHROPIC_API_KEY: 'k' });
function load(n) { const p = path.join(REPO, `api/${n}.js`); delete require.cache[require.resolve(p)]; return require(p); }
function res() { const r = { statusCode: 200 }; r.status = (c) => { r.statusCode = c; return r; }; r.json = (d) => { r.body = d; return r; }; r.setHeader = () => {}; r.end = () => r; return r; }
async function call(h, who, body, noAuth) { global.__callerId = who; const r = res(); await h({ method: 'POST', headers: noAuth ? {} : { authorization: 'Bearer t' }, body }, r); return r; }

const note = 'Hi Jane, I run Webese, a small agency that builds custom websites for trades. Would be good to connect.';
const follow = 'Thanks for connecting, Jane. We build custom websites for plumbers and similar trades. If a better website is on your list this year, I am happy to send a short example. No pressure either way. Sam, Webese';

(async () => {
  const ld = require(path.join(REPO, 'api/_lib/linkedin-drafts.js'));
  const prospect = { id: 'p1', name: 'Jane Smith', title: 'Owner', company: 'Smith Plumbing', note: '' };
  const facts = { prospect, seller: { name: 'Sam', company: 'Webese', offer: 'Custom websites for trades' } };

  console.log('\n──── what makes a draft unusable ────');
  const prob = (d, p = prospect) => ld.problemsWith(d, p, { prospect: p, seller: facts.seller });
  check('a clean draft has no problems', prob({ connectionNote: note, followUp: follow }).length === 0);
  check('a connection note over 200 characters is flagged with its length', prob({ connectionNote: 'x'.repeat(201), followUp: follow }).some(x => /201 characters — the limit is 200/.test(x)));
  check('exactly 200 characters is fine', prob({ connectionNote: 'x'.repeat(200), followUp: follow }).length === 0);
  check('a link in the connection note is flagged', prob({ connectionNote: 'Hi Jane, see webese.com', followUp: follow }).some(x => /link/.test(x)));
  check('an unfilled [placeholder] is flagged', prob({ connectionNote: note, followUp: 'Hi [First Name], thanks.' }).some(x => /placeholder/.test(x)));
  check('an invented figure is flagged', prob({ connectionNote: note, followUp: 'We helped 300 plumbers get 45% more calls.' }).some(x => /figures that were not provided/.test(x)));
  check('an empty follow-up is flagged', prob({ connectionNote: note, followUp: '' }).some(x => /follow-up is empty/.test(x)));
  for (const claim of ['I saw your recent post about pipes.', 'Congratulations on the new van!', 'I loved your talk at the trade show.', 'Great article on drains.', 'I noticed you expanded.', 'I came across your profile.']) {
    check(`"${claim}" is flagged when nothing about them was provided`, prob({ connectionNote: claim, followUp: follow }).some(x => /claims to have seen or admired/.test(x)));
  }
  check('the same claim is allowed when the user typed a note about them', prob({ connectionNote: 'I saw your recent post about pipes.', followUp: follow }, { ...prospect, note: 'Posted about pipe repairs last week' }).length === 0);

  console.log('\n──── buildDrafts: one rewrite, then flagged ────');
  const ps = [prospect, { id: 'p2', name: 'Sam Lee', title: 'Manager', company: 'Bright Dental', note: '' }];
  const good = (id) => ({ id, connectionNote: note, followUp: follow });
  let calls = 0;
  let r = await ld.buildDrafts(ps, facts.seller, {}, { write: async () => { calls++; return [good('p1'), good('p2')]; } });
  check('clean drafts need no rewrite', calls === 1 && r.drafts.every(d => d.usable));
  calls = 0; let sawFix = null;
  r = await ld.buildDrafts(ps, facts.seller, {}, { write: async (l, s, o) => { calls++; if (o.fix) { sawFix = o.fix; return [good('p2')]; } return [good('p1'), { id: 'p2', connectionNote: 'I saw your post!', followUp: follow }]; } });
  check('only the failing person is rewritten, told exactly what was wrong', calls === 2 && sawFix.length === 1 && sawFix[0].id === 'p2' && /claims to have seen/.test(sawFix[0].problems[0]));
  check('the rewrite is accepted if it now passes; the other draft is untouched', r.drafts.every(d => d.usable) && r.rewrittenOk === 1);
  r = await ld.buildDrafts(ps, facts.seller, {}, { write: async (l, s, o) => [good('p1'), { id: 'p2', connectionNote: 'I saw your post!', followUp: follow }] });
  check('if it still fails, the draft is flagged and not usable — never silently fixed', r.drafts[1].usable === false && r.drafts[1].problems.length > 0 && r.drafts[0].usable);
  r = await ld.buildDrafts(ps, facts.seller, {}, { write: async (l, s, o) => (o.fix ? (() => { throw new Error('down'); })() : [good('p1')]) });
  check('a person the model skipped gets one more try, and is flagged if that cannot run', r.drafts[1].usable === false && /No draft was written/.test(r.drafts[1].problems[0]));
  r = await ld.buildDrafts(ps, facts.seller, {}, { write: async () => [good('p1'), good('p2'), good('p99')] });
  check('a draft for someone who was not asked about is ignored', r.drafts.length === 2);
  r = await ld.buildDrafts(Array.from({ length: 14 }, (_, i) => ({ id: 'p' + i, name: 'N' + i })), facts.seller, {}, { write: async (l) => l.map(p => good(p.id)) });
  check('at most ten people per mission', r.drafts.length === 10);

  console.log('\n──── the endpoint ────');
  const mod = load('mission-linkedin'), arts = load('mission-artifacts');
  const base = { action: 'draft', prospects: [{ clientId: 77, name: 'Jane Smith', title: 'Owner', company: 'Smith Plumbing', linkedinUrl: 'https://www.linkedin.com/in/jane-smith?trk=x' }, { name: 'Sam Lee', company: 'Bright Dental', note: 'Posted about new chairs' }], offer: 'Custom websites for trades', senderName: 'Sam', companyName: 'Webese', projectId: PROJECT };
  writeImpl = (a) => ({ drafts: [{ id: 'p1', connectionNote: note, followUp: follow }, { id: 'p2', connectionNote: 'Hi Sam, saw your post about the new chairs. Keen to connect.', followUp: follow }] });
  check('no session is refused', (await call(mod, null, base, true)).statusCode === 401);
  check('an unknown action is refused', (await call(mod, OWNER, { action: 'send' })).statusCode === 400);
  let r0 = await call(mod, OWNER, { ...base, offer: '', senderName: '', prospects: [] });
  check('missing offer, sender and people are all asked for at once', r0.body.status === 'needs_input' && r0.body.questions.map(x => x.field).sort().join() === 'offer,prospects,sender');
  check('a company name alone does not stand in for a sender', (await call(mod, OWNER, { ...base, senderName: '' })).body.questions[0].field === 'sender');
  check('a stranger cannot write into someone else\'s business profile', (await call(mod, STRANGER, { ...base, projectId: undefined, intelProfileId: PROFILE })).statusCode === 403);
  check('with no profile or project it stops, saying why', (await call(mod, OWNER, { ...base, projectId: undefined })).body.code === 'no_scope');
  check('none of that called the model or saved anything', claudeCalls.length === 0 && db.artifacts.length === 0);

  fetched = [];
  let a = await call(mod, OWNER, base);
  const art = db.artifacts[0];
  check('drafts are saved pending approval under the linkedin agent', a.body.status === 'drafted' && art.status === 'pending_approval' && art.agent_key === 'linkedin' && art.kind === 'linkedin_drafts' && a.body.usable === 2);
  check('the browser\'s own id travels with each draft so it can be filed against the right prospect', a.body.drafts[0].clientId === '77' && a.body.drafts[1].clientId === null);
  check('only a real linkedin.com/in/ address is kept, with tracking stripped', a.body.drafts[0].linkedinUrl === 'https://www.linkedin.com/in/jane-smith' && a.body.drafts[1].linkedinUrl === '');
  check('nothing was ever fetched from LinkedIn or anywhere else but our own database', fetched.every(u => /x\.test|auth\/v1/.test(u)) && !fetched.some(u => /linkedin/i.test(u)));
  const sent = claudeCalls[0];
  check('the model sees only the supplied facts: name, title, company, typed note, sender', /Jane Smith/.test(sent.user) && /Posted about new chairs/.test(sent.user) && /Custom websites for trades/.test(sent.user) && !/linkedin\.com/.test(sent.user));
  check('the rules forbid claiming to have seen anything and forbid sending', /NEVER claim to have seen/.test(sent.system));
  writeImpl = () => ({ drafts: [{ id: 'p1', connectionNote: 'Hi Jane, see webese.com', followUp: follow }, { id: 'p2', connectionNote: 'Hi Sam, see webese.com', followUp: follow }] });
  const e = await call(mod, OWNER, base);
  const emptyArt = db.artifacts.find(x => x.id === e.body.artifactId);
  check('if no draft passes, the artifact is empty and there is nothing to approve', e.body.status === 'empty' && emptyArt.status === 'empty' && /nothing to approve/.test(e.body.note));
  check('an empty set cannot be approved', (await call(arts, OWNER, { action: 'approve', artifactId: emptyArt.id })).statusCode === 409);
  writeImpl = () => new Error('model down');
  check('a model failure is reported, not saved', (await call(mod, OWNER, base)).statusCode === 502);

  console.log('\n──── approve: records the OK, contacts no one ────');
  writeImpl = () => ({ drafts: [{ id: 'p1', connectionNote: note, followUp: follow }, { id: 'p2', connectionNote: 'Hi Sam, see webese.com', followUp: follow }] });
  const mx = await call(mod, OWNER, base);
  const mixed = db.artifacts.find(x => x.id === mx.body.artifactId);
  fetched = [];
  const ap = await call(arts, OWNER, { action: 'approve', artifactId: mixed.id });
  check('only the drafts that passed are approved and returned; the failing one is counted', ap.body.ok && ap.body.result.approved === 1 && ap.body.result.skipped === 1 && ap.body.result.drafts[0].name === 'Jane Smith');
  check('approval makes no outside call at all', fetched.length <= 3 && !fetched.some(u => /linkedin|resend|api\.anthropic/i.test(u)));
  check('it can only be approved once', (await call(arts, OWNER, { action: 'approve', artifactId: mixed.id })).statusCode === 409);

  console.log('\n──── the browser module ────');
  const lm = require(path.join(REPO, 'web/js/linkedin-mission.js'));
  const lines = lm.parseProspectLines('Jane Smith, Owner, Smith Plumbing, linkedin.com/in/jane\n\nSam Lee, Manager\n  , nobody');
  check('lines are parsed into name, title, company and a LinkedIn address', lines[0].name === 'Jane Smith' && lines[0].company === 'Smith Plumbing' && lines[0].linkedinUrl === 'https://linkedin.com/in/jane' && lines[1].title === 'Manager' && lines.length === 3);
  const sp = lm.sanitizeParams({ prospects: 'Jane Smith, Owner, Smith Plumbing\nJane Smith, Owner, Smith Plumbing\n, x', offer: ' Websites ' });
  check('duplicates and nameless lines are dropped, the offer tidied', sp.prospects.length === 1 && sp.offer === 'Websites');
  check('a non-LinkedIn address is not kept', lm.sanitizeParams({ prospects: [{ name: 'A', linkedinUrl: 'https://evil.example/in/a' }] }).prospects[0].linkedinUrl === '');
  check('people and an offer are both required', lm.missingInputs({}).length === 2 && lm.missingInputs({ offer: 'x' }).length === 1 && lm.missingInputs({ offer: 'x', prospects: [{ name: 'A' }] }).length === 0);
  check('at most ten people', lm.sanitizeParams({ prospects: Array.from({ length: 15 }, (_, i) => ({ name: 'N' + i })) }).prospects.length === 10);

  const mem = {}; const store = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = v; } };
  store.setItem(lm.STORE_KEY, JSON.stringify([
    { id: 1, name: 'Jane Smith', title: 'Owner', company: 'Smith Plumbing', status: 'new', notes: 'Met at expo' },
    { id: 2, name: 'Old Lead', status: 'won', notes: '' },
    { id: 3, name: 'Redo', company: 'X', status: 'new', notes: `${lm.MARKER} —\nConnection note: stale` },
  ]));
  const stored = lm.readStoredProspects(store);
  check('only prospects still marked new are offered, with their own notes as the only facts', stored.length === 2 && stored[0].note === 'Met at expo');
  check('our own earlier drafts are never fed back in as facts', stored[1].note === '');
  const m1 = lm.mergeApprovedDrafts([{ clientId: 1, name: 'Jane Smith', company: 'Smith Plumbing', connectionNote: 'CN', followUp: 'FU' }, { clientId: null, name: 'New Person', title: 'T', company: 'C', connectionNote: 'CN2', followUp: 'FU2' }], store);
  const after = JSON.parse(store.getItem(lm.STORE_KEY));
  check('drafts are filed against the matching prospect and a new person is added', m1.updated === 1 && m1.added === 1 && after.length === 4);
  check('the user\'s own note is kept, with the draft appended', /^Met at expo/.test(after[0].notes) && /Connection note: CN/.test(after[0].notes) && /Follow-up after they accept: FU/.test(after[0].notes));
  check('a stage is never advanced — nothing has been sent', after.every(p => p.status !== 'messaged' && p.status !== 'connected'));
  lm.mergeApprovedDrafts([{ clientId: 1, name: 'Jane Smith', company: 'Smith Plumbing', connectionNote: 'CN3', followUp: 'FU3' }], store);
  const again = JSON.parse(store.getItem(lm.STORE_KEY));
  check('filing again replaces our block instead of piling up', (again[0].notes.match(/Scotty draft ready/g) || []).length === 1 && /CN3/.test(again[0].notes) && !/CN\b(?!3)/.test(again[0].notes.replace('Connection note: CN3','')));

  const jr = (st, b) => ({ ok: st < 400, status: st, json: async () => b });
  const reqs = []; const task = { params: { prospects: [{ name: 'Jane' }], offer: 'x' } };
  const out = await lm.runLinkedInDrafts(task, { authHeaders: async () => ({}), sender: { senderName: 'Sam', companyName: 'Webese' }, language: 'en-AU', projectId: PROJECT, fetchImpl: async (u, o) => { reqs.push(JSON.parse(o.body)); return jr(200, { status: 'drafted', artifactId: 'a1', drafts: [{ name: 'Jane', usable: true, problems: [], connectionNote: 'c', followUp: 'f' }], usable: 1 }); } });
  check('one request carries people, offer, sender, language and scope', reqs.length === 1 && reqs[0].senderName === 'Sam' && reqs[0].language === 'en-AU' && reqs[0].projectId === PROJECT && reqs[0].prospects.length === 1 && out.complete);
  let again2 = 0; await lm.runLinkedInDrafts(task, { authHeaders: async () => ({}), fetchImpl: async () => { again2++; return jr(200, {}); } });
  check('a retry does not write (and pay for) a second set', again2 === 0);
  let threw = ''; try { await lm.runLinkedInDrafts({ params: { prospects: [{ name: 'J' }], offer: 'x' } }, { authHeaders: async () => ({}), fetchImpl: async () => jr(200, { status: 'needs_input', questions: [{ question: 'Who is sending these?' }] }) }); } catch (er) { threw = er.message; }
  check('a question from the server surfaces as a failure, not a made-up draft', /Who is sending these/.test(threw));
  threw = ''; try { await lm.runLinkedInDrafts({ params: {} }, { authHeaders: async () => ({}), fetchImpl: async () => jr(200, {}) }); } catch (er) { threw = er.message; }
  check('missing people or offer is refused before any request', /who the messages are for/.test(threw) && /what you are offering/.test(threw));
  check('the report says nothing is sent and nothing touches LinkedIn', /Nothing has been sent and nothing touches LinkedIn/.test(lm.describeResult({ usable: 1, drafts: [{ name: 'J', usable: true, problems: [] }] })));

  console.log('\n──── Scotty ────');
  const osrc = fs.readFileSync(path.join(REPO, 'web/js/scotty-orchestrator.js'), 'utf8');
  const orch = new Function('window', 'document', `${osrc}\nreturn window.ScottyOrchestrator;`)({ localStorage: { getItem: () => null, setItem() {}, removeItem() {} } }, { readyState: 'complete', querySelectorAll: () => [], addEventListener() {} });
  check('LinkedIn Outreach is a real executor; compliance is not', orch.isRealExecutor('linkedin') && !orch.isRealExecutor('compliance'));
  const page = fs.readFileSync(path.join(REPO, 'web/scotty.html'), 'utf8');
  check('the page runs it only for a task the planner marked real', /task\.agentKey === 'linkedin' && task\.realExecutor === 'linkedin'/.test(page) && /<script src="\/js\/linkedin-mission\.js">/.test(page));
  check('the start gate demands people and an offer', /LinkedInMission\.missingInputs\(t\.params\)/.test(page));
  check('the plan card says it never sends and cannot search LinkedIn', /never sends anything or touches LinkedIn/.test(page) && /can't search for people/.test(page));
  check('person-derived text is escaped on screen', /_renderLinkedInResult[\s\S]*_escapeAttr\(d\.connectionNote\)[\s\S]*_escapeAttr\(d\.followUp\)/.test(page));
  check('approval says nothing is sent and nothing touches LinkedIn', /Nothing is sent and nothing touches LinkedIn/.test(page));
  check('approval files the drafts into the LinkedIn Outreach prospect list', /LinkedInMission\.mergeApprovedDrafts\(r\.drafts/.test(page));

  console.log(failures === 0 ? '\nALL ASSERTIONS PASSED\n' : `\n${failures} FAILED\n`);
  process.exit(failures === 0 ? 0 : 1);
})();
