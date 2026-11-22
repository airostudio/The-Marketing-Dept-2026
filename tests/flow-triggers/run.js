/**
 * Automatic enrolment (api/cron-flow-triggers.js): activating a flow must
 * never mail the existing audience; only people who arrive afterwards are
 * enrolled, once, never if suppressed, never twice, bounded per run, and a
 * problem in one flow never stops the others.
 *
 *   node tests/flow-triggers/run.js
 */
'use strict';
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
let failures = 0;
function check(label, ok) { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`); if (!ok) failures++; }
function mockModule(rel, exp) { const p = require.resolve(path.join(REPO, rel)); require.cache[p] = { id: p, filename: p, loaded: true, exports: exp }; }

const U = 'u1';
const db = {};
function reset() {
  Object.assign(db, { flows: [], steps: [{ flow_id: 'f1', step_order: 1, delay_hours: 24 }], contacts: [], segments: [], members: [], seen: [], enrolments: [], suppressed: [], suppFail: 0, failEnrol: false, reports: [], noColumn: false });
}
const q = (p, k) => { const m = p.match(new RegExp(`[?&]${k}=eq\\.([^&]+)`)); return m ? decodeURIComponent(m[1]) : null; };
const all = (p, k) => [...p.matchAll(new RegExp(`[?&]${k}=([a-z]+)\\.([^&]+)`, 'g'))].map(m => ({ op: m[1], val: decodeURIComponent(m[2]) }));
const inList = (p, k) => { const m = p.match(new RegExp(`[?&]${k}=in\\.\\(([^)]*)\\)`)); return m ? m[1].split(',').map(decodeURIComponent) : null; };

mockModule('api/_lib/supabase-rest.js', {
  isUuid: () => true,
  sbRest: async (url, key, method, p, body) => {
    if (p.startsWith('/rpc/suppressed_emails')) {
      if (db.suppFail) return { ok: false, status: db.suppFail, data: null };
      return { ok: true, data: db.suppressed.filter(r => body.addresses.includes(r.email)) };
    }
    if (p.startsWith('/email_flows')) {
      if (method === 'PATCH') { const f = db.flows.find(x => x.id === q(p, 'id')); Object.assign(f, body); return { ok: true, data: [f] }; }
      return { ok: true, data: db.flows.filter(f => f.status === 'active' && ['contact_created', 'segment_entry'].includes(f.trigger_type)).map(f => { const c = { ...f }; if (db.noColumn) delete c.trigger_checked_at; return c; }) };
    }
    if (p.startsWith('/email_flow_steps')) return { ok: true, data: db.steps.filter(s => s.flow_id === q(p, 'flow_id')) };
    if (p.startsWith('/segments')) return { ok: true, data: db.segments.filter(s => s.id === q(p, 'id') && s.user_id === q(p, 'user_id')) };
    if (p.startsWith('/segment_members')) return { ok: true, data: db.members.filter(m => m.segment_id === q(p, 'segment_id')) };
    if (p.startsWith('/contacts')) {
      let rows = db.contacts.filter(c => c.user_id === q(p, 'user_id') && (!q(p, 'status') || c.status === q(p, 'status')));
      const ids = inList(p, 'id'); if (ids) rows = rows.filter(c => ids.includes(c.id));
      for (const f of all(p, 'created_at')) rows = rows.filter(c => f.op === 'gt' ? c.created_at > f.val : c.created_at <= f.val);
      for (const f of all(p, 'tags')) {
        const tags = f.val.replace(/^\{|\}$/g, '').split(',').map(t => t.replace(/^"|"$/g, ''));
        rows = rows.filter(c => f.op === 'cs' ? tags.every(t => (c.tags || []).includes(t)) : tags.some(t => (c.tags || []).includes(t)));
      }
      rows = rows.slice().sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
      const lim = /limit=(\d+)/.exec(p); if (lim) rows = rows.slice(0, +lim[1]);
      return { ok: true, data: rows };
    }
    if (p.startsWith('/email_flow_trigger_seen')) {
      if (method === 'DELETE') { db.seen = db.seen.filter(s => s.flow_id !== q(p, 'flow_id')); return { ok: true }; }
      if (method === 'POST') {
        const rows = Array.isArray(body) ? body : [body];
        if (rows.some(r => db.seen.some(s => s.flow_id === r.flow_id && s.email === r.email))) return { ok: false, status: 409 };
        db.seen.push(...rows); return { ok: true, data: rows };
      }
      return { ok: true, data: db.seen.filter(s => s.flow_id === q(p, 'flow_id')) };
    }
    if (p.startsWith('/email_flow_enrolments')) {
      if (method === 'POST') {
        if (db.failEnrol) return { ok: false, status: 500 };
        if (db.enrolments.some(e => e.flow_id === body.flow_id && e.email === body.email && e.status === 'active')) return { ok: false, status: 409 };
        db.enrolments.push(body); return { ok: true, data: [body] };
      }
      const em = inList(p, 'email') || [];
      return { ok: true, data: db.enrolments.filter(e => e.flow_id === q(p, 'flow_id') && em.includes(e.email)) };
    }
    return { ok: true, data: [] };
  },
});
mockModule('api/_lib/report-failure.js', { withFailureReporting: (n, h) => h, reportFailureAsync() {}, reportFailure: async (f) => { db.reports.push(f); } });
Object.assign(process.env, { SUPABASE_URL: 'https://x.test', SUPABASE_SERVICE_ROLE_KEY: 'k', CRON_SECRET: 'cs' });

function res() { const r = { statusCode: 200 }; r.status = (c) => { r.statusCode = c; return r; }; r.json = (d) => { r.body = d; return r; }; r.setHeader = () => {}; r.end = () => r; return r; }
const cron = require(path.join(REPO, 'api/cron-flow-triggers.js'));
async function run(query = {}, token = 'cs') { const r = res(); await cron({ method: 'GET', headers: { authorization: 'Bearer ' + token }, query }, r); return r; }

const T0 = '2026-01-01T00:00:00.000Z';
const flowCC = (o = {}) => ({ id: 'f1', user_id: U, name: 'Welcome', status: 'active', trigger_type: 'contact_created', trigger_checked_at: null, ...o });
const contact = (id, email, o = {}) => ({ id, user_id: U, email, status: 'subscribed', created_at: '2025-06-01T00:00:00.000Z', tags: [], ...o });

(async () => {
  console.log('\n──── access ────');
  reset();
  check('no secret is refused', (await run({}, 'wrong')).statusCode === 401);

  console.log('\n──── contact_created ────');
  reset(); db.flows = [flowCC()]; db.contacts = [contact('c1', 'old@x.co'), contact('c2', 'old2@x.co')];
  let r = await run();
  check('first run only baselines: nobody already in the audience is enrolled', db.enrolments.length === 0 && r.body.details[0].baselined === true);
  check('and the watcher is now set to watch from this moment', !!db.flows[0].trigger_checked_at);
  const baseline = db.flows[0].trigger_checked_at;

  db.contacts.push(contact('c3', 'new@x.co', { created_at: new Date(Date.parse(baseline) + 1).toISOString() }));
  await new Promise(s => setTimeout(s, 20));
  r = await run();
  check('a contact added after activation is enrolled', db.enrolments.length === 1 && db.enrolments[0].email === 'new@x.co');
  check('the enrolment waits the first step\'s delay and carries the contact', db.enrolments[0].next_step_order === 1 && db.enrolments[0].contact_id === 'c3' && new Date(db.enrolments[0].next_run_at) > new Date());
  check('the enrolment belongs to the flow owner\'s account', db.enrolments[0].user_id === U);
  r = await run();
  check('running again does not enrol them twice', db.enrolments.length === 1);

  db.contacts.push(contact('c4', 'unsub@x.co', { status: 'unsubscribed', created_at: new Date(Date.now() + 5).toISOString() }));
  db.contacts.push(contact('c5', 'bounced@x.co', { created_at: new Date(Date.now() + 5).toISOString() }));
  db.suppressed = [{ email: 'bounced@x.co', reason: 'bounced' }];
  db.contacts.push(contact('c6', 'other@x.co', { user_id: 'someone-else', created_at: new Date(Date.now() + 5).toISOString() }));
  await new Promise(s => setTimeout(s, 20));
  r = await run();
  check('an unsubscribed contact is never enrolled', !db.enrolments.some(e => e.email === 'unsub@x.co'));
  check('an address on the suppression list is never enrolled, even if the contact says subscribed', !db.enrolments.some(e => e.email === 'bounced@x.co'));
  check('another account\'s new contact is never enrolled into this flow', !db.enrolments.some(e => e.email === 'other@x.co'));

  console.log('\n──── returning contact is not re-enrolled ────');
  reset(); db.flows = [flowCC({ trigger_checked_at: T0 })];
  db.enrolments = [{ flow_id: 'f1', email: 'back@x.co', status: 'completed' }];
  db.contacts = [contact('c1', 'back@x.co', { created_at: '2026-02-01T00:00:00.000Z' })];
  r = await run();
  check('someone who already went through the flow is not put through it again', db.enrolments.length === 1 && r.body.details[0].existing === 1);

  console.log('\n──── bounded per run, nothing lost ────');
  reset(); db.flows = [flowCC({ trigger_checked_at: T0 })];
  db.contacts = Array.from({ length: 250 }, (_, i) => contact('c' + i, `p${i}@x.co`, { created_at: new Date(Date.parse('2026-01-02') + i * 1000).toISOString() }));
  r = await run();
  check('a big arrival is capped at the per-run limit', db.enrolments.length === cron.MAX_ENROL_PER_FLOW && r.body.details[0].capped === true);
  check('the watermark stops at the last person handled, not at now', db.flows[0].trigger_checked_at === db.contacts[cron.MAX_ENROL_PER_FLOW - 1].created_at);
  r = await run();
  check('the next run picks up the rest, with nobody enrolled twice', db.enrolments.length === 250 && new Set(db.enrolments.map(e => e.email)).size === 250);

  console.log('\n──── failures hold back the watermark ────');
  reset(); db.flows = [flowCC({ trigger_checked_at: T0 })]; db.contacts = [contact('c1', 'a@x.co', { created_at: '2026-02-01T00:00:00.000Z' })];
  db.suppFail = 500;
  r = await run();
  check('an unreadable suppression list enrols nobody', db.enrolments.length === 0 && r.body.failed === 1);
  check('and the watermark does not move, so the person is retried', db.flows[0].trigger_checked_at === T0);
  check('the problem is reported for a human', db.reports.length === 1 && /Welcome/.test(db.reports[0].message));
  db.suppFail = 0;
  r = await run();
  check('once readable, they are enrolled', db.enrolments.length === 1);

  reset(); db.flows = [flowCC({ id: 'f1', trigger_checked_at: T0, name: 'Bad' }), flowCC({ id: 'f2', trigger_checked_at: T0, name: 'Good' })];
  db.steps = [{ flow_id: 'f1', step_order: 1, delay_hours: 0 }, { flow_id: 'f2', step_order: 1, delay_hours: 0 }];
  db.contacts = [contact('c1', 'a@x.co', { created_at: '2026-02-01T00:00:00.000Z' })];
  const origPost = db.failEnrol; db.failEnrol = true;
  r = await run();
  check('one flow failing does not stop the others from being processed', r.body.details.length === 2 && r.body.failed === 2);
  db.failEnrol = false;

  reset(); db.flows = [flowCC({ trigger_checked_at: T0 })]; db.steps = [];
  r = await run();
  check('a flow with no emails is skipped, not crashed', r.body.details[0].skipped === 'no_steps');

  reset(); db.flows = [flowCC({ status: 'paused' }), flowCC({ id: 'f9', trigger_type: 'manual' })];
  r = await run();
  check('paused and manual flows are not watched', r.body.flows === 0);

  reset(); db.flows = [flowCC({ trigger_checked_at: T0 })]; db.contacts = [contact('c1', 'a@x.co', { created_at: '2026-02-01T00:00:00.000Z' })];
  r = await run({ dryRun: '1' });
  check('a dry run reports who would be enrolled but changes nothing', r.body.enrolled === 1 && db.enrolments.length === 0 && db.flows[0].trigger_checked_at === T0);

  reset(); db.flows = [flowCC()]; db.noColumn = true;
  r = await run();
  check('before the migration it says what to run, rather than failing obscurely', r.statusCode === 503 && /supabase-email-flow-triggers\.sql/.test(r.body.error));

  console.log('\n──── segment_entry ────');
  const segFlow = (o = {}) => ({ id: 'f1', user_id: U, name: 'Seg', status: 'active', trigger_type: 'segment_entry', segment_id: 's1', trigger_checked_at: null, ...o });
  reset(); db.flows = [segFlow()];
  db.segments = [{ id: 's1', user_id: U, member_mode: 'dynamic', filter_rules: { tagsAll: ['vip'], status: 'subscribed' } }];
  db.contacts = [contact('c1', 'in1@x.co', { tags: ['vip'] }), contact('c2', 'in2@x.co', { tags: ['vip', 'x'] }), contact('c3', 'no@x.co', { tags: ['other'] })];
  r = await run();
  check('first run baselines the members already in the segment without enrolling them', db.enrolments.length === 0 && db.seen.length === 2 && r.body.details[0].alreadyInSegment === 2);
  db.contacts.push(contact('c4', 'joins@x.co', { tags: ['vip'] }));
  db.contacts.find(c => c.id === 'c3').tags.push('vip');
  r = await run();
  check('people who join afterwards are enrolled (including an existing contact who gains the tag)', db.enrolments.map(e => e.email).sort().join() === 'joins@x.co,no@x.co');
  r = await run();
  check('entering fires once: they are not enrolled again next run', db.enrolments.length === 2);
  db.contacts.find(c => c.id === 'c3').tags = ['other']; db.contacts.find(c => c.id === 'c3').tags.push('vip');
  r = await run();
  check('leaving and re-joining does not enrol them a second time', db.enrolments.length === 2);

  reset(); db.flows = [segFlow({ trigger_checked_at: T0 })];
  db.segments = [{ id: 's1', user_id: U, member_mode: 'static' }];
  db.contacts = [contact('c1', 'm1@x.co'), contact('c2', 'm2@x.co'), contact('c3', 'gone@x.co', { status: 'unsubscribed' })];
  db.members = [{ segment_id: 's1', contact_id: 'c1' }, { segment_id: 's1', contact_id: 'c3' }];
  r = await run();
  check('static segments work, and unsubscribed members are left out', db.enrolments.map(e => e.email).join() === 'm1@x.co');

  reset(); db.flows = [segFlow({ trigger_checked_at: T0 })];
  db.segments = [{ id: 's1', user_id: 'someone-else', member_mode: 'dynamic', filter_rules: {} }];
  db.contacts = [contact('c1', 'a@x.co')];
  r = await run();
  check('a segment belonging to another account resolves to nothing and is reported, never to their audience', db.enrolments.length === 0 && r.body.failed === 1);

  reset(); db.flows = [segFlow({ trigger_checked_at: T0 })]; db.segments = [];
  r = await run();
  check('a deleted segment is reported for a human', r.body.failed === 1 && /no longer exists/.test(r.body.details[0].error));

  reset(); db.flows = [segFlow({ trigger_checked_at: T0, segment_id: null })];
  r = await run();
  check('a segment flow with no segment is skipped', r.body.details[0].skipped === 'no_segment');

  console.log('\n──── activation resets the baseline ────');
  const flowsApi = (() => {
    mockModule('api/_lib/profile-access.js', { canAccessRecord: async () => true, accessibleProfileIds: async () => [], ownedOrSharedFilter: () => '' });
    mockModule('api/_lib/rate-limit.js', { rateLimited: () => false });
    delete require.cache[require.resolve(path.join(REPO, 'api/email-flows.js'))];
    return require(path.join(REPO, 'api/email-flows.js'));
  })();
  global.fetch = async () => ({ ok: true, json: async () => ({ id: U }) });
  reset(); db.flows = [flowCC({ trigger_checked_at: T0, status: 'paused' })];
  // email-flows loads the flow with GET /email_flows?id=eq.X — extend the mock for it
  const baseSb = require(path.join(REPO, 'api/_lib/supabase-rest.js')).sbRest;
  require.cache[require.resolve(path.join(REPO, 'api/_lib/supabase-rest.js'))].exports.sbRest = async (u, k, m, p, b) => {
    if (m === 'GET' && p.startsWith('/email_flows?id=eq.')) return { ok: true, data: db.flows.filter(f => f.id === q(p, 'id')) };
    return baseSb(u, k, m, p, b);
  };
  delete require.cache[require.resolve(path.join(REPO, 'api/email-flows.js'))];
  const flowsApi2 = require(path.join(REPO, 'api/email-flows.js'));
  const rr = res(); await flowsApi2({ method: 'POST', headers: { authorization: 'Bearer t' }, body: { action: 'setStatus', flowId: 'f1', status: 'active' } }, rr);
  check('activating an automatic flow resets its baseline so the audience is not swept in', rr.body.ok && db.flows[0].status === 'active' && db.flows[0].trigger_checked_at === null);
  db.flows = [{ id: 'f1', user_id: U, name: 'M', status: 'paused', trigger_type: 'manual' }];
  const r2 = res(); await flowsApi2({ method: 'POST', headers: { authorization: 'Bearer t' }, body: { action: 'setStatus', flowId: 'f1', status: 'active' } }, r2);
  check('a manual flow is activated without touching the trigger column (works before the migration)', r2.body.ok && db.flows[0].status === 'active' && !('trigger_checked_at' in db.flows[0]));

  console.log(failures === 0 ? '\nALL ASSERTIONS PASSED\n' : `\n${failures} FAILED\n`);
  process.exit(failures === 0 ? 0 : 1);
})();
