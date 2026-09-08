/**
 * Email Delivery and Audience Manager checks.
 *
 * The audit found the send path sound in the parts that draft and review a
 * campaign, and unguarded in the parts that actually send it:
 *
 *   1. api/send-campaign.js and api/send-email.js had NO authentication and
 *      Access-Control-Allow-Origin: *. Any caller could send arbitrary
 *      content to arbitrary addresses through the account's Resend key, from
 *      its verified sending domain. That is an open relay on a domain with
 *      earned deliverability.
 *   2. Neither endpoint checked whether a recipient had opted out. The only
 *      suppression gate was client-side, in a function whose dynamic branch
 *      honoured the segment's own filter_rules.status.
 *   3. Unsubscribe was keyed on contact_id, so an ad-hoc recipient's click
 *      recorded nothing while the page promised they would not be emailed
 *      again.
 *   4. The daily limit was a module-level counter shared by every customer
 *      and reset on every cold start.
 *
 *   node tests/email-delivery/run.js
 */
const path = require('path');
const REPO = path.resolve(__dirname, '../..');

const fail = [];
const check = (name, cond) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name);
  if (!cond) fail.push(name);
};
const read = f => require('fs').readFileSync(path.join(REPO, f), 'utf8');

/* ── Fake Supabase ──────────────────────────────────────────────────────── */
let db;
const { resetForTests: resetRateLimits } = require(path.join(REPO, 'api/_lib/rate-limit.js'));

function reset() {
  // The burst limiter is shared state now, not a Map inside each endpoint's
  // own module, so it outlives a scenario the way the fake database would if
  // this did not clear it. send-campaign allows three a minute by design;
  // this suite runs more scenarios than that.
  resetRateLimits();
  db = {
    suppressions: [],      // {user_id, email, reason}
    contacts: [],          // {id, user_id, email, status}
    sends: [],             // campaign_sends
    quota: {},             // user -> sent today
    cap: 500,
    missing: new Set(),
    validToken: true,
  };
}

const helperPath = path.join(REPO, 'api/_lib/supabase-rest.js');
require.cache[helperPath] = {
  id: helperPath, filename: helperPath, loaded: true,
  exports: {
    sbRest: async (u, k, method, p, body) => {
      const table = p.split('?')[0].replace('/', '').replace('rpc/', '');
      if (db.missing.has(table)) return { ok: false, status: 404, data: null };

      if (table === 'suppressed_emails') {
        const wanted = new Set((body.addresses || []).map(a => String(a).trim().toLowerCase()));
        const out = [];
        db.suppressions.filter(s => s.user_id === body.uid && wanted.has(s.email))
          .forEach(s => out.push({ email: s.email, reason: s.reason }));
        db.contacts.filter(c => c.user_id === body.uid && c.status !== 'subscribed'
                             && wanted.has(c.email.toLowerCase()))
          .forEach(c => out.push({ email: c.email.toLowerCase(), reason: c.status }));
        return { ok: true, status: 200, data: out };
      }
      if (table === 'claim_send_quota') {
        const used = db.quota[body.uid] || 0;
        const granted = Math.min(body.want, Math.max(body.cap - used, 0));
        // Negative want is a release; it must not drive the counter below 0.
        db.quota[body.uid] = Math.max(0, used + (body.want < 0 ? body.want : granted));
        return { ok: true, status: 200, data: body.want < 0 ? 0 : granted };
      }
      if (p.startsWith('/profiles')) {
        return { ok: true, status: 200, data: [{ id: 'user-1', plan: 'growth', daily_send_limit: db.cap }] };
      }
      if (p.startsWith('/email_suppressions')) {
        if (method === 'POST') {
          const e = String(body.email).trim().toLowerCase();
          if (db.suppressions.some(s => s.user_id === body.user_id && s.email === e)) {
            return { ok: false, status: 409, data: null };
          }
          db.suppressions.push({ user_id: body.user_id, email: e, reason: body.reason });
          return { ok: true, status: 201, data: [body] };
        }
      }
      if (p.startsWith('/contacts')) {
        if (method === 'PATCH') {
          const id = p.split('id=eq.')[1].split('&')[0];
          const c = db.contacts.find(x => x.id === id);
          if (c) c.status = body.status;
          return { ok: true, status: 200, data: c ? [c] : [] };
        }
        const id = /id=eq\.([^&]+)/.exec(p);
        if (id) {
          const c = db.contacts.find(x => x.id === id[1]);
          return { ok: true, status: 200, data: c ? [c] : [] };
        }
      }
      if (p.startsWith('/campaign_sends')) {
        const em = /email=eq\.([^&]+)/.exec(p);
        const rows = em ? db.sends.filter(s => s.email === decodeURIComponent(em[1])) : db.sends;
        return { ok: true, status: 200, data: rows };
      }
      return { ok: false, status: 404, data: null };
    },
  },
};

const sendCampaign = require(path.join(REPO, 'api/send-campaign.js'));
const sendEmail = require(path.join(REPO, 'api/send-email.js'));
const unsubscribe = require(path.join(REPO, 'api/unsubscribe.js'));

let resendCalls = [];
let callSeq = 0;
global.fetch = async (url, opts) => {
  if (String(url).includes('/auth/v1/user')) {
    return db.validToken
      ? { ok: true, json: async () => ({ id: 'user-1' }) }
      : { ok: false, json: async () => ({}) };
  }
  if (String(url).includes('api.resend.com')) {
    resendCalls.push(JSON.parse(opts.body));
    return { ok: true, json: async () => ({ id: 'em_' + resendCalls.length }) };
  }
  throw new Error('unexpected fetch ' + url);
};

function env() {
  process.env.SUPABASE_URL = 'https://x.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
  process.env.RESEND_API_KEY = 'rk';
  process.env.RESEND_FROM_EMAIL = 'hello@acme.test';
  process.env.UNSUBSCRIBE_SECRET = 'unsub-secret';
}

async function call(handler, body, opts) {
  env();
  opts = opts || {};
  let status = 200, payload = null, sent = null;
  const res = {
    setHeader() {}, status(c) { status = c; return this; },
    json(o) { payload = o; return this; },
    send(o) { sent = o; return this; },
    end() { return this; },
  };
  // A distinct client IP per call. The endpoints rate-limit per IP (3 campaign
  // sends a minute), which is correct behaviour but would otherwise throttle
  // the suite itself and turn every later assertion into a 429 — a harness
  // artefact that looks exactly like a broken endpoint.
  const headers = { host: 'app.test', 'x-forwarded-for': `10.0.0.${++callSeq % 250}` };
  if (!opts.noAuth) headers.authorization = 'Bearer t';
  await handler({ method: opts.method || 'POST', headers, query: opts.query || {}, body }, res);
  return { status, body: payload, html: sent };
}

(async () => {
  /* ── 1. Authentication ────────────────────────────────────────────────── */
  console.log('──── the send endpoints are no longer an open relay ────');
  reset();

  const campaign = { subject: 'Hi', html: '<p>Hello</p>', recipients: [{ to: 'a@x.test' }] };

  resendCalls = [];
  let r = await call(sendCampaign, campaign, { noAuth: true });
  check('a campaign send with no token is refused', r.status === 401);
  check('and nothing was sent', resendCalls.length === 0);

  db.validToken = false;
  r = await call(sendCampaign, campaign);
  check('an invalid token is refused', r.status === 401);
  check('and still nothing was sent', resendCalls.length === 0);
  db.validToken = true;

  r = await call(sendEmail, { to: 'a@x.test', subject: 'Hi', html: '<p>x</p>' }, { noAuth: true });
  check('the single-send endpoint refuses an unauthenticated call too', r.status === 401);

  const campaignSrc = read('api/send-campaign.js');
  const emailSrc = read('api/send-email.js');
  check('both endpoints accept an Authorization header through CORS',
    /Allow-Headers[^)]*Authorization/.test(campaignSrc) &&
    /Allow-Headers[^)]*Authorization/.test(emailSrc));
  check('and both authenticate before doing anything else',
    /authenticateSender\(req\)/.test(campaignSrc) && /authenticateSender\(req\)/.test(emailSrc));

  // Every client call site has to carry the token or the send just 401s.
  ['web/js/email-delivery-service.js', 'web/agents/email-delivery-agent.html',
   'web/agents/sales-agent.html', 'web/marketing/lead-generation.html'].forEach(f => {
    check(`${path.basename(f)} sends its session with the request`,
      /sendAuthHeaders\(\)/.test(read(f)));
  });

  /* ── 2. Suppression, enforced on the server ───────────────────────────── */
  console.log('\n──── nobody who opted out gets mailed ────');
  reset();
  db.suppressions.push({ user_id: 'user-1', email: 'gone@x.test', reason: 'unsubscribed' });
  db.contacts.push({ id: 'c1', user_id: 'user-1', email: 'bounced@x.test', status: 'bounced' });

  resendCalls = [];
  r = await call(sendCampaign, { subject: 'Hi', html: '<p>x</p>', recipients: [
    { to: 'ok@x.test' }, { to: 'gone@x.test' }, { to: 'bounced@x.test' },
  ] });
  check('the send succeeds for the one sendable address',
    r.status === 200 && r.body.sent === 1);
  check('only that address actually reached the provider',
    resendCalls.length === 1 && resendCalls[0].to[0] === 'ok@x.test');
  check('the suppressed pair are reported back, with the reason',
    r.body.suppressed === 2 &&
    r.body.rejected.some(x => /unsubscribed/.test(x.error)) &&
    r.body.rejected.some(x => /bounced/.test(x.error)));

  // Case and whitespace must not be a way around the list.
  resendCalls = [];
  r = await call(sendCampaign, { subject: 'Hi', html: '<p>x</p>',
    recipients: [{ to: '  GONE@X.test ' }] });
  check('a differently-cased address is still suppressed', resendCalls.length === 0);

  // The whole list suppressed is a clean outcome, not an error.
  r = await call(sendCampaign, { subject: 'Hi', html: '<p>x</p>',
    recipients: [{ to: 'gone@x.test' }] });
  check('an entirely suppressed list sends nothing and says so',
    r.status === 200 && r.body.sent === 0 && /opted out/i.test(r.body.note));

  // Single sends respect it too.
  resendCalls = [];
  r = await call(sendEmail, { to: 'gone@x.test', subject: 'Hi', html: '<p>x</p>' });
  check('a one-off send to a suppressed address is refused',
    r.status === 409 && r.body.code === 'suppressed' && resendCalls.length === 0);

  // Fail closed.
  reset();
  db.missing.add('suppressed_emails');
  resendCalls = [];
  r = await call(sendCampaign, campaign);
  check('an uninstalled suppression list stops the send rather than sending anyway',
    r.status === 503 && r.body.code === 'not_installed' && resendCalls.length === 0);
  check('and says which migration to run', /supabase-email-suppression\.sql/.test(r.body.error));

  /* ── 3. Unsubscribe keeps its promise ─────────────────────────────────── */
  console.log('\n──── unsubscribe records what it promises ────');
  reset();

  const { sign } = require(path.join(REPO, 'api/_lib/unsubscribe-token.js'));
  const b64 = s => Buffer.from(s).toString('base64url');

  // A known contact.
  db.contacts.push({ id: 'c9', user_id: 'user-1', email: 'known@x.test', status: 'subscribed' });
  r = await call(unsubscribe, {}, { method: 'POST', query: {
    c: 'c9', e: b64('known@x.test'), t: sign('c9', 'known@x.test') } });
  check('a known contact is marked unsubscribed',
    db.contacts[0].status === 'unsubscribed');
  check('and the address is added to the suppression list',
    db.suppressions.some(s => s.email === 'known@x.test'));
  check('and the page confirms it', /won't receive marketing email/i.test(r.html));

  // An ad-hoc recipient with no contact row — the case that used to record
  // nothing while promising the opposite.
  db.sends.push({ user_id: 'user-1', email: 'pasted@x.test' });
  r = await call(unsubscribe, {}, { method: 'POST', query: {
    c: '-', e: b64('pasted@x.test'), t: sign(null, 'pasted@x.test') } });
  check('an ad-hoc recipient with no contact record is suppressed by address',
    db.suppressions.some(s => s.email === 'pasted@x.test'));
  check('and only then is told they will not be emailed again',
    /won't receive marketing email/i.test(r.html));

  // And the suppression actually takes effect on the next send.
  resendCalls = [];
  r = await call(sendCampaign, { subject: 'Hi', html: '<p>x</p>',
    recipients: [{ to: 'pasted@x.test' }] });
  check('the next send to that pasted address is blocked', resendCalls.length === 0);

  // When nothing could be recorded, do not promise.
  db.missing.add('email_suppressions');
  r = await call(unsubscribe, {}, { method: 'POST', query: {
    c: '-', e: b64('nowhere@x.test'), t: sign(null, 'nowhere@x.test') } });
  check('an unrecordable opt-out does not claim to have worked',
    !/won't receive marketing email/i.test(r.html) && /couldn't complete/i.test(r.html));

  // A forged link changes nothing.
  reset();
  r = await call(unsubscribe, {}, { method: 'POST', query: {
    c: '-', e: b64('victim@x.test'), t: 'not-a-real-signature' } });
  check('a forged unsubscribe link is rejected',
    /no longer valid/i.test(r.html) && db.suppressions.length === 0);

  /* ── 4. Quota is per account and persisted ────────────────────────────── */
  console.log('\n──── the daily limit belongs to one account ────');
  reset();
  db.cap = 2;

  resendCalls = [];
  r = await call(sendCampaign, { subject: 'Hi', html: '<p>x</p>',
    recipients: [{ to: 'a@x.test' }, { to: 'b@x.test' }, { to: 'c@x.test' }] });
  check('the send is trimmed to the account\'s remaining budget',
    r.body.sent === 2 && resendCalls.length === 2);
  check('and the excess is reported rather than silently dropped',
    r.body.rejected.some(x => /Daily send limit/.test(x.error)));

  r = await call(sendCampaign, { subject: 'Hi', html: '<p>x</p>', recipients: [{ to: 'd@x.test' }] });
  check('a further send once spent is refused', r.status === 429);
  check('and names the account\'s own cap, not a global one',
    /Daily send limit of 2 reached for this account/.test(r.body.error));

  check('the counter is persisted per user, not held in module scope',
    db.quota['user-1'] === 2);
  check('and the endpoint no longer keeps a shared in-memory counter',
    !/let dailySendCount/.test(campaignSrc) && !/let dailySendCount/.test(emailSrc));

  // daily_send_limit is nullable with no default, so an account that has
  // never had it explicitly set gets `null` back from Supabase, not 0.
  // Number(null) is 0 — if that isn't guarded against, every such account
  // reads as "capped at zero" and can never send anything.
  reset();
  db.cap = null;
  resendCalls = [];
  r = await call(sendEmail, { to: 'a@x.test', subject: 'Hi', html: '<p>x</p>' });
  check('an account with no daily_send_limit set falls back to the default cap, not zero',
    r.status === 200 && resendCalls.length === 1);

  // Quota claimed but not spent must come back.
  reset();
  db.cap = 10;
  global.fetch = (orig => async (url, opts) => {
    if (String(url).includes('api.resend.com')) {
      return { ok: false, status: 500, text: async () => 'provider down', json: async () => ({}) };
    }
    return orig(url, opts);
  })(global.fetch);
  r = await call(sendEmail, { to: 'a@x.test', subject: 'Hi', html: '<p>x</p>' });
  check('a provider failure hands the claimed send back to the quota',
    db.quota['user-1'] === 0);

  /* ── 5. Segments never resolve to someone who opted out ───────────────── */
  console.log('\n──── the audience side ────');
  const store = read('web/js/contacts-store.js');
  // Comment lines stripped first: the fix explains itself by quoting the
  // expression it removed, and matching that would make this an assertion
  // about prose rather than about shipped code.
  const storeCode = store.split('\n')
    .filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  check('a dynamic segment cannot be configured to return unsubscribed people',
    !/rules\.status \|\| SENDABLE/.test(storeCode));
  check('both segment branches filter to sendable',
    (storeCode.match(/SENDABLE/g) || []).length >= 3);
  check('re-importing a contact does not resurrect their status',
    !/status:\s*'subscribed'/.test(storeCode.split('async function upsertContacts')[1].split('return')[0]));

  console.log('\n' + (fail.length === 0
    ? 'ALL ASSERTIONS PASSED'
    : `${fail.length} FAILED: ${fail.join(' | ')}`));
  process.exit(fail.length === 0 ? 0 : 1);
})();
