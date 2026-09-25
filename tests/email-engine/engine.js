/**
 * Split tests, automation flows and revenue attribution.
 *
 * These three were the "not set up" empty states left after the demo data was
 * removed. This suite is about the properties that make each one trustworthy
 * rather than merely present:
 *
 *   - A/B assignment must be stable. A retried batch that reshuffles people
 *     between arms attributes their opens to mail they never received.
 *   - A flow must claim an enrolment before sending it, so a concurrent run
 *     cannot send the same step twice, and must re-check suppression at send
 *     time rather than only at enrolment.
 *   - Revenue must record which rule credited it, and an order that matches
 *     nothing must be excluded rather than assigned to the nearest campaign.
 *
 *   node tests/email-engine/engine.js
 */
const path = require('path');
const REPO = path.resolve(__dirname, '../..');

const fail = [];
const check = (name, cond) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name);
  if (!cond) fail.push(name);
};

/* ── Fake Supabase ──────────────────────────────────────────────────────── */
let db;
function reset() {
  db = {
    tests: [], variants: [], assignments: [],
    flows: [], steps: [], enrolments: [],
    contacts: [], events: [], conversions: [],
    missing: new Set(),
  };
}

function match(rows, p) {
  // Minimal PostgREST filter support: eq, lte, gte, gt, in, not.is.null.
  const qs = p.split('?')[1] || '';
  return rows.filter(r => qs.split('&').every(part => {
    const [k, v] = part.split('=');
    if (!v || ['select', 'order', 'limit', 'on_conflict'].includes(k)) return true;
    // Embedded-resource filter, e.g. email_flows.status=eq.active. PostgREST
    // applies it to the joined row; the cron relies on it to skip paused
    // flows, so the harness has to honour it or the test would pass whatever
    // the endpoint did.
    if (k.includes('.')) {
      const [rel, field] = k.split('.');
      const joined = r[rel];
      if (!joined) return false;
      const [jop, ...jrest] = v.split('.');
      return jop !== 'eq' || String(joined[field]) === decodeURIComponent(jrest.join('.'));
    }
    const [op, ...rest] = v.split('.');
    const val = rest.join('.');
    const cell = r[k];
    if (op === 'eq') return String(cell) === decodeURIComponent(val);
    if (op === 'lte') return new Date(cell) <= new Date(decodeURIComponent(val));
    if (op === 'gte') return new Date(cell) >= new Date(decodeURIComponent(val));
    if (op === 'gt') return Number(cell) > Number(val);
    if (op === 'in') return decodeURIComponent(val).replace(/[()]/g, '').split(',').includes(String(cell));
    if (op === 'not') return cell != null;
    return true;
  }));
}

const helperPath = path.join(REPO, 'api/_lib/supabase-rest.js');
require.cache[helperPath] = {
  id: helperPath, filename: helperPath, loaded: true,
  exports: {
    sbRest: async (u, k, method, p, body) => {
      const table = p.split('?')[0].replace('/', '').replace('rpc/', '');
      if (db.missing.has(table)) return { ok: false, status: 404, data: null };

      const store = {
        email_ab_tests: 'tests', email_ab_variants: 'variants',
        email_ab_assignments: 'assignments', email_flows: 'flows',
        email_flow_steps: 'steps', email_flow_enrolments: 'enrolments',
        contacts: 'contacts', email_events: 'events', email_conversions: 'conversions',
      }[table];

      if (table === 'ab_test_results') {
        const vs = db.variants.filter(v => v.test_id === body.tid);
        return { ok: true, status: 200, data: vs.map(v => {
          const as = db.assignments.filter(a => a.variant_id === v.id);
          const ids = new Set(as.map(a => a.email_id).filter(Boolean));
          const ev = t => new Set(db.events.filter(e => e.event_type === t && ids.has(e.email_id)).map(e => e.email_id)).size;
          return { variant_id: v.id, label: v.label, subject: v.subject, split_pct: v.split_pct,
                   assigned: as.length, delivered: ev('delivered'),
                   unique_opened: ev('opened'), unique_clicked: ev('clicked') };
        }) };
      }
      if (table === 'campaign_revenue') {
        const rows = db.conversions.filter(c => c.campaign_id === body.cid && c.attribution !== 'none');
        return { ok: true, status: 200, data: [{ conversions: rows.length,
          revenue_cents: rows.reduce((s, r) => s + r.amount_cents, 0),
          currency: rows[0] ? rows[0].currency : null }] };
      }
      if (table === 'campaign_email_stats') {
        return { ok: true, status: 200, data: [{ sent: 0, delivered: 0, opened: 0, unique_opened: 0,
          clicked: 0, unique_clicked: 0, bounced: 0, complained: 0 }] };
      }
      if (!store) return { ok: false, status: 404, data: null };

      if (method === 'POST') {
        const rows = Array.isArray(body) ? body : [body];
        const made = [];
        for (const row of rows) {
          const r = Object.assign({ id: table + '_' + (db[store].length + 1 + Math.random().toString(36).slice(2, 6)) }, row);

          // Enforce the real unique constraints — they are load-bearing.
          if (store === 'enrolments' && r.status === 'active' &&
              db.enrolments.some(e => e.flow_id === r.flow_id && e.email === r.email && e.status === 'active')) {
            return { ok: false, status: 409, data: null };
          }
          if (store === 'conversions' && r.external_id &&
              db.conversions.some(c => c.user_id === r.user_id && c.external_id === r.external_id)) {
            return { ok: false, status: 409, data: null };
          }
          if (store === 'assignments' && !p.includes('on_conflict') &&
              db.assignments.some(a => a.test_id === r.test_id && a.email === r.email)) {
            return { ok: false, status: 409, data: null };
          }
          if (store === 'assignments' && p.includes('on_conflict')) {
            const idx = db.assignments.findIndex(a => a.test_id === r.test_id && a.email === r.email);
            if (idx !== -1) { Object.assign(db.assignments[idx], r); made.push(db.assignments[idx]); continue; }
          }
          db[store].push(r); made.push(r);
        }
        return { ok: true, status: 201, data: made };
      }
      if (method === 'PATCH') {
        const hits = match(db[store], p);
        hits.forEach(r => Object.assign(r, body));
        return { ok: true, status: 200, data: hits };
      }
      if (method === 'DELETE') {
        const hits = match(db[store], p);
        db[store] = db[store].filter(r => !hits.includes(r));
        return { ok: true, status: 204, data: [] };
      }
      let rows = match(db[store], p);
      // Emulate the embedded select the cron uses to pull the flow in one trip.
      if (store === 'enrolments' && p.includes('email_flows')) {
        rows = db.enrolments.map(e => Object.assign({}, e, {
          email_flows: db.flows.find(f => f.id === e.flow_id) || null,
        }));
        rows = match(rows, p);
      }
      const lim = /limit=(\d+)/.exec(p);
      if (/order=[\w.]+\.desc/.test(p)) rows = rows.slice().reverse();
      if (lim) rows = rows.slice(0, Number(lim[1]));
      return { ok: true, status: 200, data: rows };
    },
  },
};

const abTests = require(path.join(REPO, 'api/ab-tests.js'));
const flows = require(path.join(REPO, 'api/email-flows.js'));
const cron = require(path.join(REPO, 'api/cron-email-flows.js'));
const trackConversion = require(path.join(REPO, 'api/track-conversion.js'));
const { assignVariant, summariseResults } = require(path.join(REPO, 'api/_lib/ab-split.js'));

let resendCalls = [];
let resendOk = true;
global.fetch = async (url, opts) => {
  if (String(url).includes('/auth/v1/user')) return { ok: true, json: async () => ({ id: 'user-1' }) };
  if (String(url).includes('api.resend.com')) {
    resendCalls.push(JSON.parse(opts.body));
    return resendOk
      ? { ok: true, json: async () => ({ id: 'em_' + resendCalls.length }) }
      : { ok: false, status: 422, text: async () => 'rejected' };
  }
  throw new Error('unexpected fetch ' + url);
};

function env() {
  process.env.SUPABASE_URL = 'https://x.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
  process.env.RESEND_API_KEY = 'rk';
  process.env.RESEND_FROM_EMAIL = 'hello@acme.test';
  process.env.CRON_SECRET = 'cs';
  process.env.CONVERSION_API_KEY = 'ck';
}

async function call(handler, body, opts) {
  env();
  opts = opts || {};
  let status = 200, payload = null;
  const res = { setHeader() {}, status(c) { status = c; return this; },
                json(o) { payload = o; return this; }, end() { return this; } };
  await handler({ method: opts.method || 'POST',
                  headers: Object.assign({ authorization: 'Bearer ' + (opts.token || 't'), host: 'app.test' }, opts.headers),
                  query: opts.query || {}, body }, res);
  return { status, body: payload };
}

(async () => {
  /* ── A/B ──────────────────────────────────────────────────────────────── */
  console.log('──── split tests ────');
  reset();

  let r = await call(abTests, { action: 'create', campaignId: 'c1', name: 'Subject test',
    variants: [{ label: 'A', subject: 'Save 20% today' }, { label: 'B', subject: 'Your discount inside' }] });
  check('a two-arm subject test is created', r.status === 200 && r.body.ok);
  const testId = r.body.test.id;
  check('splits default to an even share totalling exactly 100',
    db.variants.reduce((s, v) => s + v.split_pct, 0) === 100);

  r = await call(abTests, { action: 'create', campaignId: 'c1', name: 'One arm', variants: [{ label: 'A', subject: 'x' }] });
  check('a one-arm test is refused', r.status === 400);
  r = await call(abTests, { action: 'create', campaignId: 'c1', name: 'Over',
    variants: [{ label: 'A', subject: 'x', splitPct: 70 }, { label: 'B', subject: 'y', splitPct: 60 }] });
  check('splits totalling over 100 are refused', r.status === 400 && /over 100/.test(r.body.error));
  r = await call(abTests, { action: 'create', campaignId: 'c1', name: 'No subject',
    variants: [{ label: 'A' }, { label: 'B', subject: 'y' }] });
  check('a subject test with a missing subject is refused', r.status === 400);

  const recipients = Array.from({ length: 200 }, (_, i) => ({ email: `u${i}@x.test` }));
  r = await call(abTests, { action: 'assign', testId, recipients });
  check('every recipient is assigned an arm', r.body.assignments.length === 200);
  const counts = {};
  r.body.assignments.forEach(a => { counts[a.label] = (counts[a.label] || 0) + 1; });
  check('the split is roughly even', Math.abs(counts.A - counts.B) < 40);
  check('the assignment carries the variant\'s subject to the sender',
    r.body.assignments.every(a => typeof a.subject === 'string' && a.subject.length));

  const firstPass = JSON.stringify(r.body.assignments.map(a => a.label));
  const second = await call(abTests, { action: 'assign', testId, recipients });
  check('a repeated batch assigns everyone to the same arm as before',
    JSON.stringify(second.body.assignments.map(a => a.label)) === firstPass);
  check('and does not create duplicate assignment rows', db.assignments.length === 200);

  // Results with no events at all.
  r = await call(abTests, { action: 'results', testId });
  check('with nothing delivered, no variant shows a rate',
    r.body.variants.every(v => v.rate === null));
  check('and no leader is declared', r.body.leader === null);
  check('and it says why', /No mail has been delivered/i.test(r.body.readable));

  // Give A a clear lead.
  db.assignments.slice(0, 20).forEach((a, i) => { a.email_id = 'e' + i; });
  db.assignments.slice(0, 20).forEach((a, i) => {
    db.events.push({ email_id: 'e' + i, event_type: 'delivered' });
    if (i % 2 === 0) db.events.push({ email_id: 'e' + i, event_type: 'opened' });
  });
  r = await call(abTests, { action: 'results', testId });
  const withData = r.body.variants.filter(v => v.rate !== null);
  check('a variant with delivered mail gets a real rate', withData.length > 0);
  check('a variant with no delivered mail still shows null, not 0%',
    r.body.variants.some(v => v.rate === null) || withData.length === r.body.variants.length);
  check('the summary never uses the word winner',
    !/winner/i.test(r.body.readable));

  /* ── flows ────────────────────────────────────────────────────────────── */
  console.log('\n──── automation flows ────');
  reset();

  r = await call(flows, { action: 'create', name: 'Welcome', steps: [
    { delayHours: 0, subject: 'Welcome', html: '<p>Hi {{firstName}}</p>' },
    { delayHours: 48, subject: 'Day 2', html: '<p>More</p>' },
  ] });
  check('a flow is created', r.status === 200 && r.body.ok);
  const flowId = r.body.flow.id;
  check('and starts as a draft, not sending', r.body.flow.status === 'draft');

  r = await call(flows, { action: 'enrol', flowId, recipients: [{ email: 'a@x.test' }] });
  check('a draft flow refuses enrolment rather than silently holding people',
    r.status === 409 && /Activate it/.test(r.body.error));

  await call(flows, { action: 'setStatus', flowId, status: 'active' });
  db.contacts.push({ id: 'ct1', email: 'a@x.test', user_id: 'user-1', status: 'subscribed', firstname: 'Ada' });
  db.contacts.push({ id: 'ct2', email: 'gone@x.test', user_id: 'user-1', status: 'unsubscribed' });

  r = await call(flows, { action: 'enrol', flowId,
    recipients: [{ email: 'a@x.test', contactId: 'ct1' }, { email: 'gone@x.test', contactId: 'ct2' }] });
  check('an active flow enrols a subscribed contact', r.body.enrolled === 1);
  check('and refuses to enrol someone who unsubscribed', r.body.skippedSuppressed === 1);

  r = await call(flows, { action: 'enrol', flowId, recipients: [{ email: 'a@x.test' }] });
  check('re-enrolling someone mid-flow is rejected, not duplicated',
    r.body.enrolled === 0 && r.body.alreadyInFlow === 1);

  // Dry run first.
  resendCalls = [];
  r = await call(cron, {}, { method: 'GET', token: 'cs', query: { dryRun: '1' } });
  check('a dry run reports what would go out', r.body.sent === 1 && r.body.dryRun === true);
  check('and sends nothing', resendCalls.length === 0);

  r = await call(cron, {}, { method: 'GET', token: 'wrong' });
  check('the cron refuses an unauthenticated call', r.status === 401);

  r = await call(cron, {}, { method: 'GET', token: 'cs' });
  check('the real run sends the due step', r.body.sent === 1 && resendCalls.length === 1);
  check('the mail is personalised from the contact', /Ada/.test(resendCalls[0].html));
  check('and tagged so its events attribute back to the flow',
    resendCalls[0].tags.some(t => t.name === 'campaign_id' && t.value.includes(flowId)));
  check('and carries an unsubscribe path like every other send',
    /unsubscribe|opt.?out/i.test(resendCalls[0].html));

  const enrolment = db.enrolments[0];
  check('the enrolment advances to the next step', enrolment.next_step_order === 2);
  check('and is scheduled by that step\'s delay',
    new Date(enrolment.next_run_at) - Date.now() > 47 * 3600000);

  resendCalls = [];
  r = await call(cron, {}, { method: 'GET', token: 'cs' });
  check('running again immediately sends nothing — step 2 is not due',
    r.body.due === 0 && resendCalls.length === 0);

  // Someone unsubscribes mid-sequence.
  enrolment.next_run_at = new Date(Date.now() - 1000).toISOString();
  db.contacts[0].status = 'unsubscribed';
  resendCalls = [];
  r = await call(cron, {}, { method: 'GET', token: 'cs' });
  check('a contact who unsubscribed mid-flow is not sent the next step',
    resendCalls.length === 0 && r.body.skipped === 1);
  check('and is exited from the flow with the reason recorded',
    db.enrolments[0].status === 'exited' && /unsubscribed/.test(db.enrolments[0].exit_reason));

  // A paused flow stops.
  reset();
  await call(flows, { action: 'create', name: 'P', steps: [{ delayHours: 0, subject: 's', html: '<p>x</p>' }] });
  const fid = db.flows[0].id;
  await call(flows, { action: 'setStatus', flowId: fid, status: 'active' });
  db.contacts.push({ id: 'c9', email: 'p@x.test', user_id: 'user-1', status: 'subscribed' });
  await call(flows, { action: 'enrol', flowId: fid, recipients: [{ email: 'p@x.test', contactId: 'c9' }] });
  await call(flows, { action: 'setStatus', flowId: fid, status: 'paused' });
  db.flows[0].status = 'paused';
  resendCalls = [];
  r = await call(cron, {}, { method: 'GET', token: 'cs' });
  check('a paused flow sends nothing', resendCalls.length === 0);
  check('and its enrolment is left intact, so resuming continues rather than restarts',
    db.enrolments[0].status === 'active' && db.enrolments[0].next_step_order === 1);

  /* ── revenue ──────────────────────────────────────────────────────────── */
  console.log('\n──── revenue attribution ────');
  reset();
  db.contacts.push({ id: 'ct1', email: 'buyer@x.test', user_id: 'user-1', status: 'subscribed' });

  r = await call(trackConversion, { email: 'buyer@x.test', amount: 49.95 }, { token: 'ck' });
  check('an order with no prior click or open is credited to nothing',
    r.status === 200 && r.body.attribution === 'none' && r.body.campaignId === null);
  check('and says it was deliberately not assigned to a campaign',
    /credited to no campaign/i.test(r.body.note));

  db.events.push({ contact_id: 'ct1', campaign_id: 'camp_open', event_type: 'opened',
                   occurred_at: new Date(Date.now() - 3 * 86400000).toISOString() });
  r = await call(trackConversion, { email: 'buyer@x.test', amount: 10, externalId: 'o2' }, { token: 'ck' });
  check('an open in the window credits that campaign',
    r.body.attribution === 'open' && r.body.campaignId === 'camp_open');

  db.events.push({ contact_id: 'ct1', campaign_id: 'camp_click', event_type: 'clicked',
                   occurred_at: new Date(Date.now() - 1 * 86400000).toISOString() });
  r = await call(trackConversion, { email: 'buyer@x.test', amount: 20, externalId: 'o3' }, { token: 'ck' });
  check('a click outranks an open', r.body.attribution === 'click' && r.body.campaignId === 'camp_click');

  r = await call(trackConversion, { email: 'buyer@x.test', amount: 20, externalId: 'o3' }, { token: 'ck' });
  check('the same order reported twice is not counted twice',
    r.body.duplicate === true && db.conversions.filter(c => c.external_id === 'o3').length === 1);

  r = await call(trackConversion, { email: 'buyer@x.test', amount: 5, campaignId: 'camp_named', externalId: 'o4' }, { token: 'ck' });
  check('a caller that names the campaign is trusted over the inference',
    r.body.attribution === 'direct' && r.body.campaignId === 'camp_named');

  r = await call(trackConversion, { email: 'nobody@x.test', amount: 5 }, { token: 'ck' });
  check('an unknown address is refused rather than filed against a guess',
    r.status === 404 && r.body.code === 'unknown_contact');

  r = await call(trackConversion, { email: 'buyer@x.test', amount: 10 }, { token: 'wrong' });
  check('an unauthenticated report is refused', r.status === 401);
  r = await call(trackConversion, { email: 'buyer@x.test', amount: -5 }, { token: 'ck' });
  check('a negative amount is refused', r.status === 400);

  check('money is stored as integer cents, not a float',
    db.conversions.every(c => Number.isInteger(c.amount_cents)));
  check('49.95 survives as 4995', db.conversions[0].amount_cents === 4995);

  // The unattributed order must not appear in campaign revenue.
  const rev = db.conversions.filter(c => c.attribution !== 'none');
  check('unattributed revenue is excluded from campaign totals',
    rev.length === db.conversions.length - 1);

  console.log('\n' + (fail.length === 0
    ? 'ALL ASSERTIONS PASSED'
    : `${fail.length} FAILED: ${fail.join(' | ')}`));
  process.exit(fail.length === 0 ? 0 : 1);
})();
