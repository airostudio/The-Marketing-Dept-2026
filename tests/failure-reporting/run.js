/**
 * When something breaks, somebody who can fix it finds out.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 *
 * A great deal of work in this codebase went into making failures HONEST. A
 * PageSpeed scan that cannot run shows no score and says what failed, instead
 * of the fabricated 15/100 it used to invent. A colour that was never measured
 * is labelled unmeasured. A competitor's traffic figure nobody looked up is
 * absent rather than guessed.
 *
 * That is right for the customer and it is only half the job. The customer now
 * sees a truthful "this did not work" — and nobody who could fix it hears
 * anything. An API key expires on a Tuesday and the product quietly degrades
 * for every account until somebody complains.
 *
 * This suite covers the other half: every failure recorded, grouped by cause,
 * given a repair, and alerted on.
 *
 * ── What it checks ─────────────────────────────────────────────────────────
 *
 *   Grouping — one expired key is one incident with a count, not ten thousand
 *   rows. Without that the console is unreadable and the alerting unusable.
 *
 *   Classification — an alert is only worth sending if the person reading it
 *   knows what to do. "HTTP 429" is a fact; "the key is unset so requests go
 *   out unauthenticated and Google rate-limits those hard" is a repair.
 *
 *   Never making things worse — the reporter is called from catch blocks. If
 *   it can throw, it turns a handled failure into an unhandled one, which is
 *   the exact opposite of its job.
 *
 *   Never recording a secret — failure detail is the most tempting place in a
 *   codebase to dump everything, and the likeliest way a key ends up stored.
 *
 *   node tests/failure-reporting/run.js
 */
'use strict';

const path = require('path');
const fs = require('fs');
const Module = require('module');

const REPO = path.resolve(__dirname, '..', '..');

let failures = 0;
function check(label, ok) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failures++;
}
function read(rel) { return fs.readFileSync(path.join(REPO, rel), 'utf8'); }
function code(rel) {
  return read(rel).replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n').filter(l => !/^\s*(\/\/|\*)/.test(l)).join('\n');
}

/* ── A fake database that behaves like record_system_failure() ──────────── */

const db = { rows: new Map(), events: [], notified: [] };
function resetDb() { db.rows.clear(); db.events.length = 0; db.notified.length = 0; }

const helperPath = path.join(REPO, 'api/_lib/supabase-rest.js');
const realHelper = require(helperPath);
require.cache[helperPath] = {
  id: helperPath, filename: helperPath, loaded: true,
  exports: {
    isUuid: realHelper.isUuid,
    sbRest: async (url, key, method, p, body) => {
      if (p === '/rpc/record_system_failure') {
        const fp = body.p_fingerprint;
        let row = db.rows.get(fp);
        const isNew = !row;
        if (!row) {
          row = {
            failure_id: 'f-' + db.rows.size, fingerprint: fp, occurrences: 0,
            status: 'open', severity: body.p_severity, notified_at: null,
            source: body.p_source, kind: body.p_kind,
          };
          db.rows.set(fp, row);
        }
        row.occurrences++;
        // Severity climbs, never falls — same rule as the SQL.
        const rank = { info: 0, warning: 1, error: 2, critical: 3 };
        if (rank[body.p_severity] > rank[row.severity]) row.severity = body.p_severity;
        row.message = body.p_message;
        row.detail = body.p_detail;
        row.remedy = body.p_remedy;
        row.self_healing = body.p_self_healing;
        db.events.push({ fingerprint: fp, user_id: body.p_user_id, message: body.p_message });

        const alertDue = row.status === 'open'
          && ['error', 'critical'].includes(row.severity)
          && row.notified_at === null;
        return { ok: true, status: 200, data: [{
          failure_id: row.failure_id, is_new: isNew,
          occurrences: row.occurrences, alert_due: alertDue,
        }] };
      }
      if (p === '/rpc/mark_failure_notified') {
        db.notified.push(body.p_failure_id);
        for (const r of db.rows.values()) if (r.failure_id === body.p_failure_id) r.notified_at = new Date().toISOString();
        return { ok: true, status: 200, data: null };
      }
      if (p.startsWith('/system_failures?id=eq.')) {
        const id = p.split('id=eq.')[1].split('&')[0];
        const row = [...db.rows.values()].find(r => r.failure_id === id);
        return { ok: true, status: 200, data: row ? [Object.assign({
          first_seen: new Date().toISOString(), last_seen: new Date().toISOString(),
          affected_users: 0, notify_count: 0,
        }, row)] : [] };
      }
      if (p.startsWith('/profiles?role=in.')) {
        return { ok: true, status: 200, data: [{ email: 'admin@example.test' }] };
      }
      return { ok: false, status: 404, data: null };
    },
  },
};

const { reportFailure, reportFailureAsync, withFailureReporting,
        fingerprint, normalise, classify, scrub } =
  require(path.join(REPO, 'api/_lib/report-failure.js'));

process.env.SUPABASE_URL = 'https://x.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';

/* ── 1. Grouping ────────────────────────────────────────────────────────── */
console.log('\n──── one broken thing is one incident ────');

check('the same failure with different ids and timings groups',
  fingerprint('api/x', 'upstream_timeout', 'Timed out fetching https://a.com/p after 8000ms') ===
  fingerprint('api/x', 'upstream_timeout', 'Timed out fetching https://b.co/q after 12000ms'));

check('a uuid in the message does not split the incident',
  fingerprint('api/x', 'database_error', 'No profile for 3f2504e0-4f89-41d3-9a0c-0305e82c3301') ===
  fingerprint('api/x', 'database_error', 'No profile for 9c858901-8a57-4791-81fe-4c455b099bc9'));

// Merging these would be worse than splitting them: they are different
// problems with different repairs.
check('HTTP 429 and HTTP 500 stay separate incidents',
  fingerprint('api/x', 'upstream_error', 'Provider returned HTTP 429') !==
  fingerprint('api/x', 'upstream_error', 'Provider returned HTTP 500'));

check('the same message from two endpoints stays separate',
  fingerprint('api/a', 'k', 'same message') !== fingerprint('api/b', 'k', 'same message'));

check('normalising is bounded, so one enormous message cannot become the key',
  normalise('x'.repeat(5000)).length <= 300);

/* ── 2. Classification ──────────────────────────────────────────────────── */
console.log('\n──── an alert nobody can act on is noise ────');

const cases = [
  ['GOOGLE_PAGESPEED_API_KEY not configured', 'config_missing', 'critical', false],
  ['PageSpeed returned HTTP 429',             'upstream_error', 'warning',  true],
  ['Invalid API key',                          'integration_failure', 'critical', false],
  ['Request timed out',                        'upstream_timeout', 'warning', true],
  ['Provider returned 503 service unavailable','upstream_error', 'error',    true],
  ['relation "grants" does not exist',         'database_error', 'critical', false],
];
const wrong = cases.filter(([m, k, s]) => {
  const c = classify(m);
  return c.kind !== k || c.severity !== s;
});
check('every known cause classifies to the right kind and severity', wrong.length === 0);
wrong.forEach(([m, k, s]) => console.log(`      ${m} -> ${JSON.stringify(classify(m))}, wanted ${k}/${s}`));

const noHealFlag = cases.filter(([m, , , heal]) => classify(m).selfHealing !== heal);
check('and the ones that recover by themselves are marked as such', noHealFlag.length === 0);

check('a config failure names the variable to set',
  /GOOGLE_PAGESPEED_API_KEY/.test(classify('GOOGLE_PAGESPEED_API_KEY not configured').remedy));
check('and says where to set it, not just that it is missing',
  /Vercel/.test(classify('SOME_API_KEY not configured').remedy));
check('a self-healing cause explains why it needs no action',
  /clear|resets|recovers|Transient/i.test(classify('Request timed out').recovery || ''));
check('an unrecognised failure still records, with no invented remedy',
  classify('something nobody predicted').kind === 'unhandled_exception' &&
  classify('something nobody predicted').remedy === null);

/* ── 3. Never store a secret ────────────────────────────────────────────── */
console.log('\n──── failure detail is not a place to keep a key ────');

const dirty = scrub({
  apiKey: 'sk-live-abcdefghij',
  Authorization: 'Bearer eyJhbGciOi.payload',
  cookie: 'session=x',
  status: 502,
  note: 'upstream said sk-proj-9f8e7d6c5b4a3 was rejected',
  nested: { password: 'hunter2', fine: 'keep me' },
});
check('keys named like a secret are dropped',
  dirty.apiKey === '<redacted>' && dirty.Authorization === '<redacted>' && dirty.cookie === '<redacted>');
check('and so are secrets hiding inside an innocent field',
  dirty.note === '<redacted>');
check('nested ones too', dirty.nested.password === '<redacted>');
check('while the useful detail survives',
  dirty.status === 502 && dirty.nested.fine === 'keep me');

/* ── 4. The reporter must never make things worse ───────────────────────── */
console.log('\n──── called from a catch block, so it cannot throw ────');

(async () => {
  resetDb();

  check('reportFailureAsync returns nothing and does not throw',
    reportFailureAsync({ source: 'api/x', message: 'boom' }) === undefined);

  // Called with rubbish, from a path that has already gone wrong.
  let threw = false;
  try {
    reportFailureAsync(null);
    reportFailureAsync({});
    reportFailureAsync({ source: {}, message: { toString() { throw new Error('nope'); } } });
  } catch { threw = true; }
  check('nor when handed nonsense', threw === false);

  // With nowhere to record, it must still return rather than reject.
  const savedUrl = process.env.SUPABASE_URL;
  delete process.env.SUPABASE_URL;
  const unconfigured = await reportFailure({ source: 'api/x', message: 'no db' });
  check('with no database it reports failure to record, rather than throwing',
    unconfigured.recorded === false);
  process.env.SUPABASE_URL = savedUrl;

  /* ── 5. Recording and counting ────────────────────────────────────────── */
  console.log('\n──── a flood becomes one row with a count ────');

  resetDb();
  for (let i = 0; i < 25; i++) {
    await reportFailure({
      source: 'api/pagespeed',
      message: `Timed out fetching https://site${i}.example/page after ${8000 + i}ms`,
      userId: `user-${i % 3}`,
      suppressAlert: true,
    });
  }
  check('twenty-five occurrences produce one incident', db.rows.size === 1);
  const only = [...db.rows.values()][0];
  check('with the count on it', only.occurrences === 25);
  check('and every occurrence kept for detail', db.events.length === 25);

  await reportFailure({ source: 'api/pagespeed', message: 'GOOGLE_PAGESPEED_API_KEY not configured', suppressAlert: true });
  check('a different cause on the same endpoint is a second incident', db.rows.size === 2);

  /* ── 6. Severity climbs, it does not fall ─────────────────────────────── */
  console.log('\n──── an incident that got worse stays worse ────');

  resetDb();
  await reportFailure({ source: 'api/x', message: 'Request timed out', suppressAlert: true });          // warning
  const row = [...db.rows.values()][0];
  const firstSeverity = row.severity;
  await reportFailure({ source: 'api/x', message: 'Request timed out', severity: 'critical', suppressAlert: true });
  check('a warning that becomes critical is recorded as critical',
    firstSeverity === 'warning' && row.severity === 'critical');

  /* ── 7. Alerting ──────────────────────────────────────────────────────── */
  console.log('\n──── somebody is told, once ────');

  resetDb();
  const sent = [];
  const realFetch = global.fetch;
  global.fetch = async (url, init) => {
    if (String(url).includes('resend.com')) { sent.push(JSON.parse(init.body)); return { ok: true, status: 200 }; }
    return { ok: false, status: 404 };
  };
  process.env.RESEND_API_KEY = 're_test';
  process.env.RESEND_FROM_EMAIL = 'alerts@example.test';

  await reportFailure({ source: 'api/pagespeed', message: 'Invalid API key' });
  await new Promise(r => setTimeout(r, 120));     // the alert is fire-and-forget
  check('a new critical incident emails the administrators', sent.length === 1);
  check('to a real recipient', sent[0] && Array.isArray(sent[0].to) && sent[0].to.length === 1);
  check('the subject names the severity and the source',
    sent[0] && /CRITICAL/.test(sent[0].subject) && /api\/pagespeed/.test(sent[0].subject));
  check('the body carries the repair, not just the error',
    sent[0] && /replaced|key is wrong|expired/i.test(sent[0].html));
  check('and a link to the console',
    sent[0] && /admin\/failures\.html/.test(sent[0].html));
  check('the incident is marked notified only after the send succeeded',
    db.notified.length === 1);

  // The whole point of the cooldown: an incident that is still happening does
  // not send an email per request.
  const before = sent.length;
  for (let i = 0; i < 20; i++) await reportFailure({ source: 'api/pagespeed', message: 'Invalid API key' });
  await new Promise(r => setTimeout(r, 120));
  check('twenty more occurrences of it send no further email', sent.length === before);

  // A failed send must leave the incident due, not look delivered.
  resetDb(); sent.length = 0;
  global.fetch = async (url) => (String(url).includes('resend.com')
    ? { ok: false, status: 500 } : { ok: false, status: 404 });
  await reportFailure({ source: 'api/other', message: 'Invalid API key' });
  await new Promise(r => setTimeout(r, 120));
  check('an alert that Resend refused is not recorded as sent', db.notified.length === 0);

  global.fetch = realFetch;

  /* ── 8. The endpoint wrapper ──────────────────────────────────────────── */
  console.log('\n──── the failures nobody wrote a message for ────');

  resetDb();
  let status = null, headersSent = false;
  const res = {
    setHeader() {}, get headersSent() { return headersSent; },
    status(c) { status = c; headersSent = true; return this; }, json() { return this; },
  };
  const wrapped = withFailureReporting('api/demo', async () => {
    throw new TypeError("Cannot read properties of undefined (reading 'score')");
  });
  await wrapped({ method: 'POST', body: {} }, res);
  await new Promise(r => setTimeout(r, 80));
  check('a handler that throws still answers the caller', status === 500);
  check('and the throw is recorded', db.rows.size === 1);
  const thrown = [...db.rows.values()][0];
  check('with a few stack frames, not the whole thing',
    thrown.detail && typeof thrown.detail.stack === 'string' &&
    thrown.detail.stack.split('\n').length <= 6);

  // A handler that answered for itself must not be answered over the top of.
  resetDb();
  status = null; headersSent = false;
  const alreadyAnswered = withFailureReporting('api/demo2', async (req, r) => {
    r.status(400).json({ error: 'bad input' });
    throw new Error('and then it fell over');
  });
  await alreadyAnswered({ method: 'POST', body: {} }, res);
  check('a handler that already responded keeps its own response', status === 400);

  // A handler that succeeds must be untouched.
  resetDb();
  status = null; headersSent = false;
  const fine = withFailureReporting('api/demo3', async (req, r) => r.status(200).json({ ok: true }));
  await fine({ method: 'POST', body: {} }, res);
  await new Promise(r => setTimeout(r, 50));
  check('a handler that works records nothing', status === 200 && db.rows.size === 0);

  /* ── 9. Coverage ──────────────────────────────────────────────────────── */
  console.log('\n──── every failure path reaches the log ────');

  const endpoints = fs.readdirSync(path.join(REPO, 'api'))
    .filter(f => f.endsWith('.js') && f !== 'sso.js');
  const unwrapped = endpoints.filter(f => !/withFailureReporting\(/.test(code(path.join('api', f))));
  check(`all ${endpoints.length} endpoints report what they do not catch`, unwrapped.length === 0);
  if (unwrapped.length) console.log('      ', unwrapped);

  // The shared helpers every agent goes through.
  check('the model helper reports every way it can fail',
    /reportFailureAsync/.test(code('api/_lib/nancy-claude.js')));
  check('the search and screenshot providers report theirs',
    /reportFailureAsync/.test(code('api/_lib/nancy-providers.js')));
  // Every failure return in that file goes through unavailable(); the only
  // literal left is the one inside unavailable() itself, which uses shorthand
  // (`reason`, not `reason:`) and so does not match this.
  const providerRaw = (code('api/_lib/nancy-providers.js')
    .match(/return \{ available: false, reason:/g) || []).length;
  check('and no provider path returns unavailable without recording it',
    providerRaw === 0);

  // The browser half.
  const reporter = code('web/js/failure-reporter.js');
  check('the browser reporter listens for uncaught errors and rejections',
    /addEventListener\('error'/.test(reporter) && /addEventListener\('unhandledrejection'/.test(reporter));
  check('it caps and dedupes, so a broken page cannot hammer the endpoint',
    /MAX_PER_PAGE/.test(reporter) && /DEDUPE_MS/.test(reporter));
  check('and it is loaded by the pages that can authenticate',
    fs.readdirSync(path.join(REPO, 'web')).length > 0 &&
    countPagesWithReporter() >= 50);

  // The scan the user asked about specifically: a failed PageSpeed run shows
  // no score AND tells an administrator.
  const pulse = code('web/seo-pulse.html');
  check('a failed PageSpeed scan is reported, not just shown',
    /reportFailure\(`PageSpeed scan failed/.test(pulse));
  check('and it still shows no fabricated score',
    /pageSpeedError/.test(pulse) && !/performance = 15\b/.test(pulse));

  console.log(failures === 0 ? '\nALL ASSERTIONS PASSED\n' : `\n${failures} FAILED\n`);
  process.exit(failures === 0 ? 0 : 1);
})();

function countPagesWithReporter(dir = 'web', n = 0) {
  for (const e of fs.readdirSync(path.join(REPO, dir), { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) n = countPagesWithReporter(rel, n);
    else if (e.name.endsWith('.html') && read(rel).includes('failure-reporter.js')) n++;
  }
  return n;
}
