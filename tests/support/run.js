/**
 * Support ticketing checks.
 *
 * The endpoint holds the service-role key, which bypasses RLS entirely, so
 * every one of these assertions is really the same question: does the server
 * re-establish who the caller is before it answers?
 *
 * Three things must hold or the feature is worse than not having one:
 *
 *   1. An internal note must never leave the server in a customer's response.
 *      Not hidden in the page — absent from the payload.
 *   2. A customer must not be able to read, reply to, or reclassify another
 *      customer's ticket, and must not be able to learn that it exists.
 *   3. Nothing about identity — role, plan, ownership — may be taken from the
 *      request body.
 *
 *   PLAYWRIGHT_PATH=/opt/node22/lib/node_modules/playwright node tests/support/run.js
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '../..');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');

const fail = [];
const check = (name, cond) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name);
  if (!cond) fail.push(name);
};

/* ── A tiny in-memory stand-in for the two tables ───────────────────────── */
let db, tablesMissing;

function reset() {
  tablesMissing = false;
  db = {
    profiles: {
      'cust-1':  { id: 'cust-1',  role: 'user',  plan: 'growth', email: 'a@x.com', firstname: 'Ada' },
      'cust-2':  { id: 'cust-2',  role: 'user',  plan: 'free',   email: 'b@x.com', firstname: 'Ben' },
      'admin-1': { id: 'admin-1', role: 'admin', plan: 'free',   email: 'ops@audema.com' },
    },
    tickets: [],
    replies: [],
    seq: 0,
  };
}

/** Apply the trg_support_reply_bump trigger's behaviour, so the tests exercise
 *  the same status transitions production gets. */
function bump(reply) {
  if (reply.internal) return;
  const t = db.tickets.find(x => x.id === reply.ticket_id);
  if (!t) return;
  t.last_reply_at = reply.created_at;
  t.last_reply_by = reply.author_role;
  if (reply.author_role === 'customer') t.status = 'open';
  else if (reply.author_role === 'support' && t.status === 'open') t.status = 'pending';
}

const helperPath = path.join(REPO, 'api/_lib/supabase-rest.js');
require.cache[helperPath] = {
  id: helperPath, filename: helperPath, loaded: true,
  exports: {
    sbRest: async (u, k, method, p, body) => {
      const miss = { ok: false, status: 404, data: null };

      if (p.startsWith('/profiles?id=eq.')) {
        const id = p.split('id=eq.')[1].split('&')[0];
        const row = db.profiles[id];
        return { ok: true, status: 200, data: row ? [row] : [] };
      }
      if (p.startsWith('/profiles?id=in.')) {
        const ids = p.split('in.(')[1].split(')')[0].split(',');
        return { ok: true, status: 200, data: ids.map(i => db.profiles[i]).filter(Boolean) };
      }

      if (p.startsWith('/support_tickets')) {
        if (tablesMissing) return miss;
        if (method === 'POST') {
          const t = Object.assign({
            id: 't' + (++db.seq), status: 'open', priority: 'normal',
            created_at: new Date().toISOString(), last_reply_at: new Date().toISOString(),
          }, body);
          db.tickets.push(t);
          return { ok: true, status: 201, data: [t] };
        }
        if (method === 'PATCH') {
          const id = p.split('id=eq.')[1].split('&')[0];
          const t = db.tickets.find(x => x.id === id);
          if (t) Object.assign(t, body);
          return { ok: true, status: 200, data: t ? [t] : [] };
        }
        if (method === 'DELETE') {
          const id = p.split('id=eq.')[1].split('&')[0];
          db.tickets = db.tickets.filter(x => x.id !== id);
          return { ok: true, status: 204, data: [] };
        }
        // GET
        let rows = db.tickets.slice();
        // Anchored on the query separator: 'user_id=eq.' contains 'id=eq.',
        // so a substring test here silently filters the wrong column and
        // returns an empty list that every assertion then passes vacuously.
        const byId = /[?&]id=eq\.([^&]+)/.exec(p);
        if (byId) rows = rows.filter(t => t.id === byId[1]);
        const byUser = /[?&]user_id=eq\.([^&]+)/.exec(p);
        if (byUser) rows = rows.filter(t => t.user_id === byUser[1]);
        if (p.includes('status=eq.')) {
          const s = p.split('status=eq.')[1].split('&')[0];
          rows = rows.filter(t => t.status === s);
        }
        // Honour order=, or the ordering assertions would pass on insertion
        // order and never actually test the endpoint's query.
        const ord = /order=([a-z_]+)\.(asc|desc)/.exec(p);
        if (ord) {
          const [, field, dir] = ord;
          rows.sort((a, b) => String(a[field] || '').localeCompare(String(b[field] || '')));
          if (dir === 'desc') rows.reverse();
        }
        return { ok: true, status: 200, data: rows };
      }

      if (p.startsWith('/support_ticket_replies')) {
        if (tablesMissing) return miss;
        if (method === 'POST') {
          const r = Object.assign({ id: 'r' + (++db.seq), internal: false,
                                    created_at: new Date().toISOString() }, body);
          db.replies.push(r);
          bump(r);
          return { ok: true, status: 201, data: [r] };
        }
        let rows = db.replies.slice();
        const tid = p.split('ticket_id=eq.')[1].split('&')[0];
        rows = rows.filter(r => r.ticket_id === tid);
        // The endpoint asks for internal=eq.false when the caller is not an
        // admin; honouring that here is what makes the leak test meaningful.
        if (p.includes('internal=eq.false')) rows = rows.filter(r => !r.internal);
        return { ok: true, status: 200, data: rows };
      }

      return miss;
    },
  },
};

const handler = require(path.join(REPO, 'api/support-tickets.js'));

let asUser = 'cust-1';
global.fetch = async (url) => {
  if (String(url).includes('/auth/v1/user')) {
    return asUser
      ? { ok: true, json: async () => ({ id: asUser }) }
      : { ok: false, json: async () => ({}) };
  }
  throw new Error('unexpected fetch ' + url);
};

async function call(body, opts) {
  opts = opts || {};
  process.env.SUPABASE_URL = 'https://x.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
  let status = 200, payload = null;
  const res = { setHeader() {}, status(c) { status = c; return this; },
                json(o) { payload = o; return this; }, end() { return this; } };
  await handler({ method: 'POST',
                  headers: { authorization: opts.noAuth ? '' : 'Bearer t' },
                  body }, res);
  return { status, body: payload };
}

(async () => {
  /* ── 1. Raising and threading ─────────────────────────────────────────── */
  console.log('──── raising a ticket ────');
  reset();
  asUser = 'cust-1';

  let r = await call({ action: 'create', subject: 'Reports export is blank',
                       body: 'I click export and get an empty file.',
                       category: 'bug', pageUrl: 'https://app/reports' });
  check('a customer can raise a ticket', r.status === 200 && r.body.ok);
  const t1 = r.body.ticket.id;

  check('the opening message becomes the first reply in the thread',
    db.replies.filter(x => x.ticket_id === t1).length === 1);
  check('the plan is stamped from the profile, not the request',
    db.tickets[0].plan_at_open === 'growth');

  r = await call({ action: 'create', subject: '   ', body: 'x' });
  check('an empty subject is refused', r.status === 400);
  r = await call({ action: 'create', subject: 'x', body: '' });
  check('an empty message is refused', r.status === 400);

  r = await call({ action: 'create', subject: 'x', body: 'y', category: 'nonsense' });
  check('an unknown category falls back to question rather than erroring',
    r.status === 200 && db.tickets[1].category === 'question');

  // A customer must not be able to open a ticket claiming a plan or a role.
  r = await call({ action: 'create', subject: 'z', body: 'z',
                   plan_at_open: 'enterprise', author_role: 'support', user_id: 'admin-1' });
  const forged = db.tickets[db.tickets.length - 1];
  check('a customer cannot forge the plan, role or owner on a ticket',
    forged.plan_at_open === 'growth' && forged.user_id === 'cust-1');

  /* ── 2. Internal notes ────────────────────────────────────────────────── */
  console.log('\n──── internal notes never reach the customer ────');
  asUser = 'admin-1';
  await call({ action: 'reply', ticketId: t1, body: 'Reproduced on staging.', internal: true });
  await call({ action: 'reply', ticketId: t1, body: 'Thanks — we can see it too, fixing today.' });

  asUser = 'cust-1';
  r = await call({ action: 'thread', ticketId: t1 });
  const bodies = JSON.stringify(r.body);
  check('the customer sees the public reply',
    r.body.replies.some(x => /fixing today/.test(x.body)));
  check('the internal note is absent from the customer payload entirely',
    !/Reproduced on staging/.test(bodies));
  check('and no internal row is included under any flag',
    r.body.replies.every(x => x.internal === false));
  check('the customer is not told they are an admin', r.body.viewerIsAdmin === false);

  asUser = 'admin-1';
  r = await call({ action: 'thread', ticketId: t1 });
  check('support does see the internal note',
    r.body.replies.some(x => x.internal === true && /Reproduced/.test(x.body)));

  // A customer cannot write a hidden message either.
  asUser = 'cust-1';
  await call({ action: 'reply', ticketId: t1, body: 'Still broken.', internal: true });
  check('a customer\'s "internal" flag is ignored, not honoured',
    db.replies.find(x => /Still broken/.test(x.body)).internal === false);
  check('and their reply is recorded as coming from the customer',
    db.replies.find(x => /Still broken/.test(x.body)).author_role === 'customer');

  /* ── 3. Status movement ───────────────────────────────────────────────── */
  console.log('\n──── status follows who spoke last ────');
  const tk = db.tickets.find(x => x.id === t1);
  check('a customer reply after a support reply reopens the ticket',
    tk.status === 'open' && tk.last_reply_by === 'customer');

  asUser = 'admin-1';
  await call({ action: 'reply', ticketId: t1, body: 'Deployed a fix.' });
  check('a support reply moves it to awaiting-the-customer', tk.status === 'pending');

  r = await call({ action: 'setStatus', ticketId: t1, status: 'resolved' });
  check('support can resolve a ticket', r.status === 200 && tk.status === 'resolved');

  asUser = 'cust-1';
  await call({ action: 'reply', ticketId: t1, body: 'Still not right.' });
  check('a customer replying to a resolved ticket reopens it', tk.status === 'open');

  asUser = 'admin-1';
  await call({ action: 'setStatus', ticketId: t1, status: 'closed' });
  asUser = 'cust-1';
  r = await call({ action: 'reply', ticketId: t1, body: 'hello?' });
  check('a closed ticket refuses a customer reply rather than swallowing it',
    r.status === 409 && /raise a new one/i.test(r.body.error));

  /* ── 4. Other people's tickets ────────────────────────────────────────── */
  console.log('\n──── one customer cannot reach another\'s ticket ────');
  asUser = 'cust-2';
  r = await call({ action: 'thread', ticketId: t1 });
  check('reading someone else\'s ticket is refused', r.status === 404);
  check('and the refusal does not reveal that the ticket exists',
    /not found/i.test(r.body.error));

  r = await call({ action: 'thread', ticketId: 'no-such-ticket' });
  check('a real-but-forbidden ticket and a missing one answer identically',
    r.status === 404 && /not found/i.test(r.body.error));

  r = await call({ action: 'reply', ticketId: t1, body: 'me too' });
  check('replying to someone else\'s ticket is refused', r.status === 404);

  r = await call({ action: 'list' });
  check('the list only ever contains the caller\'s own tickets',
    r.body.tickets.every(t => db.tickets.find(x => x.id === t.id).user_id === 'cust-2'));

  /* ── 5. Admin-only actions ────────────────────────────────────────────── */
  console.log('\n──── admin-only actions ────');
  asUser = 'cust-1';
  r = await call({ action: 'queue' });
  check('a customer cannot read the queue', r.status === 403);
  r = await call({ action: 'setStatus', ticketId: t1, status: 'closed' });
  check('a customer cannot set status', r.status === 403);
  r = await call({ action: 'setPriority', ticketId: t1, priority: 'urgent' });
  check('a customer cannot raise their own priority', r.status === 403);

  asUser = 'admin-1';
  r = await call({ action: 'setPriority', ticketId: t1, priority: 'urgent' });
  check('support can set priority', r.status === 200);
  r = await call({ action: 'setStatus', ticketId: t1, status: 'sideways' });
  check('an unknown status is refused', r.status === 400);

  r = await call({ action: 'queue', status: 'all' });
  check('the queue is ordered oldest-activity-first',
    r.body.tickets.length > 1 &&
    new Date(r.body.tickets[0].lastReplyAt) <= new Date(r.body.tickets[1].lastReplyAt));
  check('queue counts say they cover only the page returned',
    typeof r.body.countsInThisPage === 'object' && 'truncated' in r.body);
  check('the queue names the customer behind each ticket',
    r.body.tickets.every(t => t.customer && t.customer.id));

  asUser = null;
  r = await call({ action: 'list' });
  check('an invalid token is refused', r.status === 401);
  asUser = 'cust-1';
  r = await call({ action: 'list' }, { noAuth: true });
  check('no token is refused', r.status === 401);

  /* ── 6. Not installed vs empty ────────────────────────────────────────── */
  console.log('\n──── not installed is not the same as empty ────');
  reset();
  asUser = 'cust-1';
  r = await call({ action: 'list' });
  check('an account with no tickets gets an empty list, not an error',
    r.status === 200 && r.body.tickets.length === 0);

  tablesMissing = true;
  r = await call({ action: 'list' });
  check('missing tables report not_installed, not an empty list',
    r.status === 503 && r.body.code === 'not_installed');
  check('and name the migration to run', /supabase-support\.sql/.test(r.body.error));

  /* ── 7. The pages ─────────────────────────────────────────────────────── */
  console.log('\n──── the pages ────');
  reset();

  // Serve both pages against a live copy of the endpoint over HTTP.
  let serverUser = 'cust-1';
  const server = http.createServer(async (req, res) => {
    const u = req.url.split('?')[0];

    if (u === '/api/support-tickets') {
      let raw = '';
      for await (const c of req) raw += c;
      asUser = serverUser;
      const out = await call(JSON.parse(raw || '{}'));
      res.writeHead(out.status, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(out.body));
    }

    const file = u === '/support.html' ? 'web/support.html'
               : u === '/admin/support.html' ? 'web/admin/support.html' : null;
    if (file) {
      let html = fs.readFileSync(path.join(REPO, file), 'utf8');
      const role = serverUser === 'admin-1' ? 'admin' : 'user';
      // Stubs AFTER the real module tags, or the real modules overwrite them.
      html = html.replace('<script src="/js/auth.js"></script>', `<script>
        window.Supabase = {
          ready: async () => {},
          DB: { getProfile: async () => ({ role: '${role}' }) },
          getClient: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: 't' } } }) } }),
        };
        window.Auth = { getUser: async () => ({ id: '${serverUser}' }) };
      </script>`);
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(html);
    }

    const m = u.match(/^\/js\/([\w.-]+)$/);
    if (m) {
      const f = path.join(REPO, 'web/js', m[1]);
      res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8' });
      return res.end(fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '');
    }
    res.writeHead(404); res.end();
  });

  await new Promise(done => server.listen(0, done));
  const port = server.address().port;
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));

  // Customer raises one through the real form.
  await page.goto(`http://localhost:${port}/support.html`);
  await page.waitForSelector('#wrap:not([style*="display: none"])');
  await page.fill('#subject', 'Invoice has the wrong ABN');
  await page.selectOption('#category', 'billing');
  await page.fill('#body', 'The ABN on my last invoice is not ours.');
  await page.click('#btn-send');
  // Sending is two round trips (create, then reload the list). Wait for the
  // list to actually repaint rather than for a guessed number of milliseconds.
  await page.waitForFunction(
    () => !/Loading/.test(document.getElementById('list').textContent),
    null, { timeout: 5000 });
  await page.waitForTimeout(300);

  check('the form actually creates a ticket', db.tickets.length === 1);
  check('the ticket the page created carries the chosen category',
    db.tickets[0].category === 'billing');

  let listText = await page.textContent('#list');
  check('the new ticket appears in the customer\'s list',
    /Invoice has the wrong ABN/.test(listText));

  // Support answers, with a note.
  const tid = db.tickets[0].id;
  serverUser = 'admin-1';
  await page.goto(`http://localhost:${port}/admin/support.html`);
  await page.waitForSelector('#wrap:not([style*="display: none"])');
  const queueText = await page.textContent('#list');
  check('the queue shows the ticket to an admin', /Invoice has the wrong ABN/.test(queueText));
  check('the queue shows who is waiting on us', /waiting on us/i.test(queueText));

  await page.click(`.ticket[data-id="${tid}"]`);
  await page.waitForTimeout(400);
  await page.fill('#reply', 'Checking with finance now.');
  await page.check('#internal');
  await page.click('#btn-reply');
  await page.waitForTimeout(400);
  await page.fill('#reply', 'Fixed — a corrected invoice is on its way.');
  await page.click('#btn-reply');
  await page.waitForTimeout(400);

  const adminThread = await page.textContent('#thread');
  check('the admin thread shows the internal note',
    /Checking with finance now/.test(adminThread));
  check('and marks it as not visible to the customer',
    /not visible to the customer/i.test(adminThread));

  // Customer opens the same ticket.
  serverUser = 'cust-1';
  await page.goto(`http://localhost:${port}/support.html?ticket=${tid}`);
  await page.waitForSelector('#thread-card:not([style*="display: none"])');
  await page.waitForTimeout(400);
  const custHtml = await page.content();
  check('the customer sees the public reply',
    /corrected invoice is on its way/.test(custHtml));
  check('the internal note is nowhere in the customer\'s page source',
    !/Checking with finance now/.test(custHtml));
  check('the customer is told what the status means for them',
    /waiting on you/i.test(custHtml));

  check('no JS errors', errs.length === 0);
  if (errs.length) console.log('  errors:', errs.slice(0, 3));

  console.log('\n' + (fail.length === 0
    ? 'ALL ASSERTIONS PASSED'
    : `${fail.length} FAILED: ${fail.join(' | ')}`));

  await browser.close();
  server.close();
  process.exit(fail.length === 0 ? 0 : 1);
})();
