/**
 * api/cron-mission-cleanup.js — the backend cleanup agent for Scotty
 * missions. It finds what a mission left broken (a list stuck building, an
 * approved list where some leads failed to import, lookups that errored) and
 * REPORTS it for a person to handle. It fixes nothing and deletes nothing.
 * Checks it flags the right things, only once, never touches a healthy
 * artifact, never overwrites a newer change, and never reports a problem it
 * failed to flag.
 *
 *   node tests/mission-cleanup/run.js
 */
'use strict';

const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
let failures = 0;
function check(label, ok) { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`); if (!ok) failures++; }
function mockModule(rel, exp) { const p = require.resolve(path.join(REPO, rel)); require.cache[p] = { id: p, filename: p, loaded: true, exports: exp }; }

mockModule('api/_lib/report-failure.js', { withFailureReporting: (n, h) => h, reportFailure: async () => ({ recorded: true }), reportFailureAsync() {} });
mockModule('api/_lib/supabase-rest.js', { isUuid: () => true, sbRest: async () => ({ ok: true, data: [] }) });
const cron = require(path.join(REPO, 'api/cron-mission-cleanup.js'));
const { sweep, assess } = cron;

const NOW = Date.parse('2026-10-20T12:00:00Z');
const ago = (min) => new Date(NOW - min * 60000).toISOString();
const art = (over) => ({ id: over.id, user_id: 'u1', title: 'Plumbers in Austin', kind: 'blade_leads', status: 'building', created_at: ago(120), updated_at: ago(5), payload: { leads: [] }, ...over });

function fakeSb(rows, { failFlag = false, changedUnderneath = false } = {}) {
  const log = [];
  const sb = async (method, p, body) => {
    log.push({ method, p });
    if (method === 'GET') return { ok: true, data: rows };
    const id = p.match(/id=eq\.([^&]+)/)[1];
    const seen = decodeURIComponent(p.match(/updated_at=eq\.([^&]+)/)[1]);
    if (failFlag) return { ok: false, status: 500, data: null };
    const row = rows.find(r => r.id === id);
    if (changedUnderneath || !row || row.updated_at !== seen) return { ok: true, data: [] };
    Object.assign(row, body);
    return { ok: true, data: [row] };
  };
  sb.log = log;
  return sb;
}
const collect = () => { const reports = []; const fn = async (r) => { reports.push(r); return { recorded: true }; }; fn.reports = reports; return fn; };

(async () => {
  console.log('\n──── what counts as a problem ────');
  check('a list still building after 30+ idle minutes is stalled', assess(art({ id: 'a', updated_at: ago(45), payload: { leads: [{ enriched: true }, { enriched: false }] } }), NOW).reason === 'stalled');
  check('a list that is building but recently touched is healthy — a run in progress is not a failure', assess(art({ id: 'a', updated_at: ago(5) }), NOW) === null);
  check('an approved list with failed imports is a problem', assess(art({ id: 'a', status: 'approved', payload: { approval: { imported: 3, failed: 2, failedLeads: [{ email: 'x@y.co' }] } } }), NOW).reason === 'import_failed');
  check('an approved list that imported cleanly is healthy', assess(art({ id: 'a', status: 'approved', payload: { approval: { imported: 5, failed: 0 } } }), NOW) === null);
  check('a pending list with errored lookups is a problem', assess(art({ id: 'a', status: 'pending_approval', payload: { leads: [{ name: 'X', enrichError: 'email: boom' }] } }), NOW).reason === 'lookup_errors');
  check('a pending list whose lookups merely found nothing is healthy', assess(art({ id: 'a', status: 'pending_approval', payload: { leads: [{ name: 'X', email: null, enrichError: null }] } }), NOW) === null);
  check('rejected and empty lists are left alone', assess(art({ id: 'a', status: 'rejected' }), NOW) === null && assess(art({ id: 'a', status: 'empty' }), NOW) === null);
  const failedMsg = assess(art({ id: 'a', status: 'approved', payload: { approval: { imported: 3, failed: 2, failedLeads: [{ email: 'x@y.co' }] } } }), NOW);
  check('the report names exactly who failed, so a person can add them by hand', failedMsg.detail.failedLeads[0].email === 'x@y.co');

  console.log('\n──── a sweep flags, reports once, and touches nothing healthy ────');
  {
    const rows = [
      art({ id: 'stalled', updated_at: ago(60), payload: { leads: [{ enriched: false }] } }),
      art({ id: 'healthy', updated_at: ago(2) }),
      art({ id: 'importfail', status: 'approved', payload: { approval: { imported: 1, failed: 1, failedLeads: [{ email: 'a@b.co' }] } } }),
    ];
    const sb = fakeSb(rows); const report = collect();
    const r1 = await sweep({ sb, report, now: NOW });
    check('the two real problems were flagged, the healthy one was not', r1.flagged.map(f => f.artifactId).sort().join() === 'importfail,stalled');
    check('each was reported through failure reporting, once', report.reports.length === 2);
    check('reports are warnings from the cleanup agent, attributed to the owner', report.reports.every(x => x.source === 'api/cron-mission-cleanup' && x.severity === 'warning' && x.userId === 'u1'));
    check('the flag is saved on the artifact itself so the UI can show it', rows[0].payload.attention.reason === 'stalled' && !!rows[0].payload.attention.flaggedAt);
    check('the flag keeps the rest of the payload intact', Array.isArray(rows[0].payload.leads) && rows[2].payload.approval.imported === 1);
    check('a healthy artifact is never written to', !sb.log.some(l => l.method === 'PATCH' && /healthy/.test(l.p)));
    check('it only reads and flags — it never deletes or changes a status', !sb.log.some(l => l.method === 'DELETE') && rows[0].status === 'building' && rows[2].status === 'approved');

    const r2 = await sweep({ sb, report, now: NOW + 60000 });
    check('the very next sweep reports nothing new', r2.flagged.length === 0 && report.reports.length === 2);
    // (The in-progress run finished in the meantime; left in, it would
    // rightly look stalled half an hour on.)
    rows.splice(rows.findIndex(r => r.id === 'healthy'), 1);
    const r3 = await sweep({ sb, report, now: NOW + 31 * 60000 });
    check('and even once the stalled list looks idle again, it is recognised as already flagged — never reported twice', r3.flagged.length === 0 && r3.alreadyFlagged === 2 && report.reports.length === 2);
  }

  console.log('\n──── a change made while it was looking is never overwritten ────');
  {
    const rows = [art({ id: 's', updated_at: ago(60), payload: { leads: [{ enriched: false }] } })];
    const report = collect();
    const r = await sweep({ sb: fakeSb(rows, { changedUnderneath: true }), report, now: NOW });
    check('the flag is skipped, to be re-checked next sweep', r.skippedChanged === 1 && r.flagged.length === 0);
    check('and nothing was reported for a flag that was never saved', report.reports.length === 0);
  }

  console.log('\n──── a flag that cannot be saved is an error, not a silent pass ────');
  {
    const rows = [art({ id: 's', updated_at: ago(60), payload: { leads: [{ enriched: false }] } })];
    const report = collect();
    let err; try { await sweep({ sb: fakeSb(rows, { failFlag: true }), report, now: NOW }); } catch (e) { err = e; }
    check('it throws so the cron run itself shows as failed', !!err && /Could not flag/.test(err.message));
    check('and reported nothing, so the next sweep can retry without duplicating', report.reports.length === 0);
  }

  console.log('\n──── the cron endpoint is gated like every other cron ────');
  {
    const res = () => { const r = { statusCode: 200 }; r.status = (c) => { r.statusCode = c; return r; }; r.json = (d) => { r.body = d; return r; }; return r; };
    delete process.env.CRON_SECRET;
    let r = res(); await cron({ headers: {} }, r);
    check('no CRON_SECRET configured refuses to run', r.statusCode === 500);
    process.env.CRON_SECRET = 'sekret';
    r = res(); await cron({ headers: { authorization: 'Bearer nope' } }, r);
    check('a wrong secret is rejected', r.statusCode === 401);
  }
  {
    const vercel = JSON.parse(require('fs').readFileSync(path.join(REPO, 'vercel.json'), 'utf8'));
    check('it is actually scheduled', vercel.crons.some(c => c.path === '/api/cron-mission-cleanup'));
  }

  console.log(failures === 0 ? '\nALL ASSERTIONS PASSED\n' : `\n${failures} FAILED\n`);
  process.exit(failures === 0 ? 0 : 1);
})();
