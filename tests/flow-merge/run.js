/**
 * Automation flows use the same merge-tag rules as a campaign send:
 * {{token|fallback}}, recipient tokens (area, website), and the sender tokens
 * ({{senderName}}…) snapshotted onto the flow. Also pins the contact lookup,
 * which used wrong column names and so silently never saw an unsubscribe.
 *
 *   node tests/flow-merge/run.js
 */
'use strict';
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
let failures = 0;
function check(label, ok) { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`); if (!ok) failures++; }
function mockModule(rel, exp) { const p = require.resolve(path.join(REPO, rel)); require.cache[p] = { id: p, filename: p, loaded: true, exports: exp }; }

const fm = require(path.join(REPO, 'api/_lib/flow-merge.js'));

const db = { suppressed: [], suppFail: 0, rpcCalls: [], contacts: [], steps: [], enrolments: [], flow: null, claims: 0, failContacts: false, contactQueries: [], created: [] };
const q = (s, k) => { const m = s.match(new RegExp(`[?&]${k}=eq\\.([^&]+)`)); return m ? decodeURIComponent(m[1]) : null; };
mockModule('api/_lib/supabase-rest.js', {
  isUuid: (v) => /^[0-9a-f-]{36}$/i.test(String(v)),
  sbRest: async (u, k, method, p, body) => {
    if (p.startsWith('/email_flow_enrolments')) {
      if (method === 'PATCH') { db.patches = (db.patches || []); db.patches.push(body); if (body.status !== 'exited') db.claims++; return { ok: true, data: [{ id: 'e1' }] }; }
      return { ok: true, data: db.enrolments.map(e => ({ ...e, email_flows: db.flow })) };
    }
    if (p.startsWith('/contacts')) {
      db.contactQueries.push(p);
      if (db.failContacts) return { ok: false, status: 400, data: null };
      const uid = q(p, 'user_id'), email = q(p, 'email');
      return { ok: true, data: db.contacts.filter(c => c.user_id === uid && c.email === email) };
    }
    if (p.startsWith('/email_flow_steps')) {
      if (method === 'POST') return { ok: true, data: [] };
      if (/step_order=gt\./.test(p)) return { ok: true, data: [] };
      return { ok: true, data: db.steps };
    }
    if (p.startsWith('/email_flows')) {
      if (method === 'POST') { const row = { id: '99999999-9999-9999-9999-999999999999', ...body }; db.created.push(row); return { ok: true, data: [row] }; }
      return { ok: true, data: [] };
    }
    if (p.startsWith('/rpc/suppressed_emails')) {
      db.rpcCalls.push(body);
      if (db.suppFail) return { ok: false, status: db.suppFail, data: null };
      return { ok: true, data: db.suppressed.filter(r => body.addresses.includes(r.email)) };
    }
    return { ok: true, data: [] };
  },
});
mockModule('api/_lib/report-failure.js', { withFailureReporting: (n, h) => h, reportFailureAsync() {}, reportFailure() {} });
mockModule('api/_lib/rate-limit.js', { rateLimited: () => false });
mockModule('api/_lib/profile-access.js', { canAccessRecord: async () => true, accessibleProfileIds: async () => [], ownedOrSharedFilter: () => 'user_id=eq.u1' });

let sent = [];
global.fetch = async (url, opts) => {
  if (String(url).includes('/auth/v1/user')) return { ok: true, json: async () => ({ id: 'u1' }) };
  if (String(url).includes('api.resend.com')) { sent.push(JSON.parse(opts.body)); return { ok: true, json: async () => ({ id: 'x' }) }; }
  throw new Error('unexpected fetch ' + url);
};
Object.assign(process.env, { SUPABASE_URL: 'https://x.test', SUPABASE_SERVICE_ROLE_KEY: 'k', RESEND_API_KEY: 'r', RESEND_FROM_EMAIL: 'hi@acme.test', CRON_SECRET: 'cs' });

function res() { const r = { statusCode: 200 }; r.status = (c) => { r.statusCode = c; return r; }; r.json = (d) => { r.body = d; return r; }; r.setHeader = () => {}; r.end = () => r; return r; }
async function runCron() {
  sent = []; db.claims = 0; db.patches = [];
  delete require.cache[require.resolve(path.join(REPO, 'api/cron-email-flows.js'))];
  const cron = require(path.join(REPO, 'api/cron-email-flows.js'));
  const r = res(); await cron({ method: 'GET', headers: { authorization: 'Bearer cs', host: 'app.test' }, query: {} }, r); return r;
}
function setup({ html, subject = 'Hello', contact, sender } = {}) {
  db.flow = { id: 'f1', name: 'Welcome', status: 'active', ...(sender ? { sender_fields: sender } : {}) };
  db.enrolments = [{ id: 'e1', flow_id: 'f1', user_id: 'u1', email: 'a@x.test', next_step_order: 1 }];
  db.steps = [{ flow_id: 'f1', step_order: 1, delay_hours: 0, subject, html }];
  db.contacts = contact === null ? [] : [{ id: 'c1', user_id: 'u1', email: 'a@x.test', status: 'subscribed', first_name: 'Ada', company: 'Acme', custom_fields: { area: 'Perth' }, ...contact }];
  db.failContacts = false; db.contactQueries = []; db.suppressed = []; db.suppFail = 0; db.rpcCalls = [];
}

(async () => {
  console.log('\n──── flow-merge helpers ────');
  check('sender fields are whitelisted and bounded', JSON.stringify(fm.cleanSenderFields({ senderName: ' Jo  Lee ', hack: 'x', senderTitle: 5 })) === '{"senderName":"Jo Lee"}');
  const mf = fm.buildMergeFields({ first_name: 'Ada', custom_fields: { area: 'Perth', senderName: 'EVIL' } }, { senderName: 'Jo' });
  check('standard columns, custom fields and sender all merge', mf.firstName === 'Ada' && mf.area === 'Perth');
  check('a contact custom field cannot impersonate the sender', mf.senderName === 'Jo');
  check('copy with a bare area tag is flagged', fm.copyIssues({ subject: 's', html: '<p>{{area}}</p>' }).some(i => /fallback/.test(i)));
  check('copy using sender tokens with no sender set is flagged', fm.copyIssues({ subject: 's', html: '<p>{{senderName}}</p>' }).some(i => /no sender/.test(i)));
  check('the same copy with a sender is fine', fm.copyIssues({ subject: 's', html: '<p>Hi {{firstName|there}}, {{senderName}}</p>' }, { senderFields: { senderName: 'Jo' } }).length === 0);
  check('a bracket placeholder is flagged', fm.copyIssues({ subject: 's', html: '<p>Call [phone number]</p>' }).length > 0);
  check('an unknown tag is flagged', fm.copyIssues({ subject: 's', html: '<p>{{nickname|x}}</p>' }).some(i => /nickname/.test(i)));

  console.log('\n──── saving a flow refuses copy that cannot be sent ────');
  const flows = require(path.join(REPO, 'api/email-flows.js'));
  async function create(body) { const r = res(); await flows({ method: 'POST', headers: { authorization: 'Bearer t' }, body: { action: 'create', name: 'F', ...body } }, r); return r; }
  let r = await create({ steps: [{ delayHours: 0, subject: 'Hi', html: '<p>{{senderName}}</p>' }] });
  check('sender tokens with no sender → 422 naming the step', r.statusCode === 422 && /Step 1/.test(r.body.error) && r.body.issues.length === 1);
  r = await create({ steps: [{ delayHours: 0, subject: 'Hi', html: '<p>{{area}}</p>' }] });
  check('a bare area tag → 422', r.statusCode === 422);
  r = await create({ senderFields: { senderName: 'Jo Lee', evil: 'x' }, steps: [{ delayHours: 0, subject: 'Hi', html: '<p>Hi {{firstName|there}} — {{senderName}}</p>' }] });
  check('good copy with a sender is saved, as a draft', r.statusCode === 200 && db.created.length === 1);
  check('only whitelisted sender fields are stored', JSON.stringify(db.created[0].sender_fields) === '{"senderName":"Jo Lee"}');

  console.log('\n──── the cron merges like a campaign ────');
  setup({ html: '<p>Hi {{firstName|there}} of {{company|your business}} in {{area|your area}} — {{senderName}}, {{senderTitle}}</p>', subject: 'For {{firstName|friend}}', sender: { senderName: 'Jo Lee', senderTitle: 'CEO' } });
  r = await runCron();
  check('the email is sent', sent.length === 1 && r.body.sent === 1);
  check('contact columns, custom fields and sender all fill', sent[0] && sent[0].html.includes('Hi Ada of Acme in Perth — Jo Lee, CEO') && sent[0].subject === 'For Ada');

  setup({ html: '<p>Hi {{firstName|there}} in {{area|your area}}</p>', contact: { first_name: null, custom_fields: {} } });
  await runCron();
  check('fallbacks are used when the contact lacks the detail', sent[0] && sent[0].html.includes('Hi there in your area'));

  setup({ html: '<p>Hi {{firstName}}</p>', contact: { first_name: null } });
  await runCron();
  check('a plain firstName with none on file still sends, without a hole', sent[0] && /Hi(<|,| )/.test(sent[0].html) && !sent[0].html.includes('{{'));

  setup({ html: '<p>{{area}}</p>', contact: { custom_fields: {} } });
  r = await runCron();
  check('legacy copy with a bare tag the contact lacks is held back, not mailed as {{area}}', sent.length === 0 && r.body.details.some(d => d.outcome === 'copy_not_sendable'));

  setup({ html: '<p>Hi {{senderName}}</p>' });
  r = await runCron();
  check('a flow using sender tokens with none stored is not sent', sent.length === 0);

  setup({ html: '<p>Call [phone number]</p>' });
  await runCron();
  check('bracket placeholders block the send', sent.length === 0);

  console.log('\n──── the contact lookup ────');
  setup({ html: '<p>Hi {{firstName|there}}</p>' });
  await runCron();
  check('it asks for the contacts table\'s real columns, scoped to the account', db.contactQueries[0].includes('first_name') && db.contactQueries[0].includes('last_name') && !/firstname/.test(db.contactQueries[0]) && db.contactQueries[0].includes('user_id=eq.u1'));
  setup({ html: '<p>Hi {{firstName|there}}</p>', contact: { status: 'unsubscribed' } });
  await runCron();
  check('an unsubscribed contact is suppressed (the old lookup could never see this)', sent.length === 0);
  setup({ html: '<p>Hi {{firstName|there}}</p>', contact: { user_id: 'someone-else' } });
  await runCron();
  check('another account\'s contact with the same address does not decide this send', sent.length === 1);
  setup({ html: '<p>Hi {{firstName|there}}</p>' });
  db.failContacts = true;
  r = await runCron();
  check('if the lookup fails nothing is sent and nothing is claimed', sent.length === 0 && db.claims === 0 && r.body.details[0].outcome === 'contact_lookup_failed');

  console.log('\n──── the account suppression list ────');
  setup({ html: '<p>Hi {{firstName|there}}</p>' });
  db.suppressed = [{ email: 'a@x.test', reason: 'bounced' }];
  r = await runCron();
  check('an address on the suppression list is not mailed, even though the contact row says subscribed', sent.length === 0 && r.body.details[0].outcome === 'suppressed' && r.body.details[0].status === 'bounced');
  check('and the enrolment is closed with the reason, so it is not retried every run', db.claims === 0 && db.patches.some(b => b.status === 'exited' && b.exit_reason === 'suppressed_bounced'));

  setup({ html: '<p>Hi {{firstName|there}}</p>', contact: null });
  db.suppressed = [{ email: 'a@x.test', reason: 'unsubscribed' }];
  await runCron();
  check('it applies to enrolments with no contact row at all', sent.length === 0);

  setup({ html: '<p>Hi {{firstName|there}}</p>' });
  db.suppFail = 500;
  r = await runCron();
  check('if the list cannot be read nothing is sent and nothing is claimed', sent.length === 0 && db.claims === 0 && r.body.details[0].outcome === 'suppression_unreadable');
  setup({ html: '<p>Hi {{firstName|there}}</p>' });
  db.suppFail = 404;
  r = await runCron();
  check('a missing suppression table is reported distinctly and also blocks the send', sent.length === 0 && r.body.details[0].outcome === 'not_installed');

  setup({ html: '<p>Hi {{firstName|there}}</p>' });
  db.enrolments = [0, 1, 2].map(i => ({ id: 'e' + i, flow_id: 'f1', user_id: 'u1', email: `p${i}@x.test`, next_step_order: 1 }));
  db.contacts = [];
  await runCron();
  check('the list is read once per account for everyone due, not once per recipient', db.rpcCalls.length === 1 && db.rpcCalls[0].addresses.length === 3 && db.rpcCalls[0].uid === 'u1');
  setup({ html: '<p>Hi {{firstName|there}}</p>' });
  db.suppressed = [{ email: 'a@x.test', reason: 'complained' }];
  db.enrolments = [{ id: 'e1', flow_id: 'f1', user_id: 'u1', email: 'a@x.test', next_step_order: 1 }, { id: 'e2', flow_id: 'f1', user_id: 'u1', email: 'ok@x.test', next_step_order: 1 }];
  await runCron();
  check('only the suppressed address is held back; the rest still send', sent.length === 1 && sent[0].to[0] === 'ok@x.test');

  console.log(failures === 0 ? '\nALL ASSERTIONS PASSED\n' : `\n${failures} FAILED\n`);
  process.exit(failures === 0 ? 0 : 1);
})();
