/**
 * Analytics Brain as a real Scotty executor: the facts gathered from the
 * account's own records, the check that every figure in a report came from
 * them, api/mission-analytics.js, the approve path into Report History, the
 * shared campaign figures (api/campaign-stats.js), and the page.
 *
 *   node tests/mission-analytics/run.js
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
const NOW = Date.parse('2026-10-08T12:00:00Z');
const dAgo = (n) => new Date(NOW - n * 86400000).toISOString();

const db = {
  artifacts: [], reports: [], projects: [{ id: PROJECT, user_id: OWNER }], failReportInsert: false,
  sends: [], contacts: [], conversions: [], flows: [], enrolments: [], posts: [],
  missing: new Set(), stats: {}, revenue: {},
};
let nextId = 1; const uuid = () => `cdcdcdcd-cdcd-cdcd-cdcd-${String(nextId++).padStart(12, '0')}`;
const q = (s, k) => { const m = s.match(new RegExp(`[?&]${k}=eq\\.([^&]+)`)); return m ? decodeURIComponent(m[1]) : null; };
const gte = (s, k) => { const m = s.match(new RegExp(`[?&]${k}=gte\\.([^&]+)`)); return m ? decodeURIComponent(m[1]) : null; };

mockModule('api/_lib/supabase-rest.js', {
  isUuid: (v) => /^[0-9a-f-]{36}$/i.test(String(v)),
  sbRest: async (u, k, method, p, body) => {
    const t = (name) => p.startsWith('/' + name);
    for (const m of db.missing) if (t(m)) return { ok: false, status: 404 };
    if (t('intelligence_profiles')) { const id = q(p, 'id'), o = q(p, 'owner_id'); return { ok: true, data: [{ id: PROFILE, owner_id: OWNER }].filter(x => (!id || x.id === id) && (!o || x.owner_id === o)) }; }
    if (t('intelligence_profile_members')) return { ok: true, data: [] };
    if (t('projects')) return { ok: true, data: db.projects.filter(x => x.id === q(p, 'id') && x.user_id === q(p, 'user_id')) };
    if (t('rpc/campaign_email_stats')) { const s = db.stats[body.cid]; return s === undefined ? { ok: true, data: [{}] } : { ok: true, data: [s] }; }
    if (t('rpc/campaign_revenue')) return { ok: true, data: [db.revenue[body.cid] || { conversions: 0 }] };
    if (t('campaign_sends')) { const lo = gte(p, 'sent_at'); return { ok: true, data: db.sends.filter(r => r.user_id === q(p, 'user_id') && r.sent_at >= lo) }; }
    if (t('email_conversions')) { const lo = gte(p, 'occurred_at'); return { ok: true, data: db.conversions.filter(r => r.user_id === q(p, 'user_id') && r.occurred_at >= lo) }; }
    if (t('contacts')) return { ok: true, data: db.contacts.filter(r => r.user_id === q(p, 'user_id')) };
    if (t('email_flows')) return { ok: true, data: db.flows.filter(r => r.user_id === q(p, 'user_id')) };
    if (t('email_flow_enrolments')) return { ok: true, data: db.enrolments.filter(r => r.flow_id === q(p, 'flow_id')) };
    if (t('social_posts')) { const lo = gte(p, 'created_at'); return { ok: true, data: db.posts.filter(r => r.user_id === q(p, 'user_id') && r.source === 'organic' && r.created_at >= lo) }; }
    if (t('analytics_reports')) { if (db.failReportInsert) return { ok: false, status: 500 }; const row = { id: uuid(), ...body }; db.reports.push(row); return { ok: true, data: [row] }; }
    if (t('mission_artifacts')) {
      if (method === 'POST') { const row = { id: uuid(), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...body }; db.artifacts.push(row); return { ok: true, data: [row] }; }
      if (method === 'PATCH') { const id = q(p, 'id'), st = q(p, 'status'); const rows = db.artifacts.filter(a => a.id === id && (!st || a.status === st)); rows.forEach(a => Object.assign(a, body)); return { ok: true, data: rows }; }
      return { ok: true, data: db.artifacts.filter(a => a.id === q(p, 'id')) };
    }
    return { ok: true, data: [] };
  },
});
mockModule('api/_lib/rate-limit.js', { rateLimited: () => false });
mockModule('api/_lib/report-failure.js', { withFailureReporting: (n, h) => h, reportFailureAsync() {}, reportFailure() {} });
let written = null; let writeCalls = [];
mockModule('api/_lib/nancy-claude.js', {
  callClaudeForJSON: async (a) => { writeCalls.push(a); const d = written(a); return d instanceof Error ? { success: false, error: d.message } : { success: true, data: d }; },
});
global.fetch = async (url) => (String(url).includes('/auth/v1/user') && global.__callerId) ? { ok: true, json: async () => ({ id: global.__callerId }) } : { ok: false };
Object.assign(process.env, { SUPABASE_URL: 'https://x.test', SUPABASE_SERVICE_ROLE_KEY: 'svc', ANTHROPIC_API_KEY: 'k' });
function load(n) { const p = path.join(REPO, `api/${n}.js`); delete require.cache[require.resolve(p)]; return require(p); }
function res() { const r = { statusCode: 200 }; r.status = (c) => { r.statusCode = c; return r; }; r.json = (d) => { r.body = d; return r; }; r.setHeader = () => {}; r.end = () => r; return r; }
async function call(h, who, body, noAuth) { global.__callerId = who; const r = res(); await h({ method: 'POST', headers: noAuth ? {} : { authorization: 'Bearer t' }, body }, r); return r; }

function seed() {
  db.sends = []; db.contacts = []; db.conversions = []; db.flows = []; db.enrolments = []; db.posts = []; db.stats = {}; db.revenue = {}; db.missing = new Set();
  // campaign A: 3 recipients this period, full tracking; campaign B: 1 recipient, no open tracking; 2 sends in the previous period
  ['a1', 'a2', 'a3'].forEach(e => db.sends.push({ user_id: OWNER, campaign_id: 'A', campaign_name: 'Spring offer', subject: 'S', status: 'sent', sent_at: dAgo(5), email: e }));
  db.sends.push({ user_id: OWNER, campaign_id: 'A', campaign_name: 'Spring offer', status: 'failed', sent_at: dAgo(5) });
  db.sends.push({ user_id: OWNER, campaign_id: 'B', campaign_name: 'Newsletter', status: 'sent', sent_at: dAgo(2) });
  ['p1', 'p2'].forEach(() => db.sends.push({ user_id: OWNER, campaign_id: 'P', campaign_name: 'Old', status: 'sent', sent_at: dAgo(40) }));
  db.sends.push({ user_id: STRANGER, campaign_id: 'Z', campaign_name: 'Not mine', status: 'sent', sent_at: dAgo(1) });
  db.stats.A = { sent: 3, delivered: 3, opened: 2, unique_opened: 2, clicked: 1, unique_clicked: 1, bounced: 0, complained: 0 };
  db.stats.B = { sent: 1, delivered: 1, opened: 0, unique_opened: 0, clicked: 0, unique_clicked: 0, bounced: 0, complained: 0 };
  db.revenue.A = { conversions: 2, revenue_cents: 25050, currency: 'AUD' };
  db.conversions = [{ user_id: OWNER, amount_cents: 25050, currency: 'AUD', attribution: 'click', occurred_at: dAgo(3) }, { user_id: OWNER, amount_cents: 10000, currency: 'AUD', attribution: 'none', occurred_at: dAgo(4) }];
  db.contacts = [
    { user_id: OWNER, status: 'subscribed', created_at: dAgo(3), status_changed_at: null }, { user_id: OWNER, status: 'subscribed', created_at: dAgo(10), status_changed_at: null },
    { user_id: OWNER, status: 'subscribed', created_at: dAgo(50), status_changed_at: null }, { user_id: OWNER, status: 'unsubscribed', created_at: dAgo(60), status_changed_at: dAgo(2) },
    { user_id: STRANGER, status: 'subscribed', created_at: dAgo(1), status_changed_at: null },
  ];
  db.flows = [{ id: 'f1', user_id: OWNER, name: 'Welcome', status: 'active' }];
  db.enrolments = [{ flow_id: 'f1', status: 'active' }, { flow_id: 'f1', status: 'completed' }, { flow_id: 'f1', status: 'completed' }];
  db.posts = [
    { user_id: OWNER, source: 'organic', status: 'published', platform: 'LinkedIn', publish_status: 'published', published_at: dAgo(3), created_at: dAgo(6) },
    { user_id: OWNER, source: 'organic', status: 'scheduled', platform: 'Facebook', publish_status: 'failed', published_at: null, created_at: dAgo(4) },
    { user_id: OWNER, source: 'organic', status: 'pending_review', platform: 'LinkedIn', publish_status: 'not_connected', published_at: null, created_at: dAgo(1) },
    { user_id: OWNER, source: 'ad', status: 'approved', platform: 'Meta/Facebook', publish_status: null, published_at: null, created_at: dAgo(1) },
  ];
}

(async () => {
  const facts = require(path.join(REPO, 'api/_lib/analytics-facts.js'));
  const sbDirect = (m, p, b) => require(path.join(REPO, 'api/_lib/supabase-rest.js')).sbRest('u', 'k', m, p, b);

  console.log('\n──── verifyNumbers: the check that stops an invented figure ────');
  const f0 = { a: 1234, b: 12.5, c: 'Sent 4 Sep 2026 – 3 Oct 2026', d: { e: 85 } };
  check('quoted figures (with commas, %, $) are supported', facts.verifyNumbers('We sent 1,234 emails; 12.5% opened; $85 revenue.', f0).length === 0);
  check('a figure not in the data is caught, as written', facts.verifyNumbers('Open rate was 47.3%.', f0).join() === '47.3%');
  check('a made-up benchmark number is caught', facts.verifyNumbers('The industry average is 21%.', f0).join() === '21%');
  check('dates in the facts allow the year and day numbers', facts.verifyNumbers('For 4 Sep 2026 – 3 Oct 2026', f0).length === 0);
  check('small counts and list numbering are not nagged about', facts.verifyNumbers('1. First\n2) Second\nWe ran 3 campaigns, top 5.', f0).length === 0);
  check('but a small number with % or $ is checked', facts.verifyNumbers('Up 7% and $9.', f0).length === 2);
  check('a figure that is merely rounded from a fact passes', facts.verifyNumbers('About 12.5% and 1,234', f0).length === 0 && facts.verifyNumbers('13%', { x: 13.04 }).length === 0);

  console.log('\n──── the facts come from the account\'s own records ────');
  seed();
  const F = await facts.gatherFacts(sbDirect, { supabaseUrl: 'u', serviceKey: 'k', userId: OWNER, periodDays: 30, now: NOW });
  check('only this user\'s records count', F.email.campaignsSent === 2 && F.audience.totalContacts === 4);
  check('emails sent and failed are separate; the previous period is compared', F.email.emailsSent === 4 && F.email.emailsFailedOrRejected === 1 && F.email.previousPeriodEmailsSent === 2 && F.email.emailsSentChangePct === 100);
  const A = F.email.campaigns.find(c => c.name === 'Spring offer'), B = F.email.campaigns.find(c => c.name === 'Newsletter');
  check('a tracked campaign has real rates', A.engagement.openTracking === 'tracked' && A.engagement.rates.openRate === 66.7 && A.engagement.rates.clickRate === 33.3);
  check('an untracked campaign\'s open rate is null — "not recorded", never 0%', B.engagement.openTracking === 'not-recorded' && B.engagement.rates.openRate === null && /not a measurement of zero/.test(B.engagement.note));
  check('combined rates only use what was tracked, and say so', F.email.combined.openTracking === 'tracked' && F.email.combined.counts.uniqueOpened === 2);
  check('revenue is split into attributed and not, in major units', F.revenue.attributedToEmail === 250.5 && F.revenue.notAttributed === 100 && F.revenue.currency === 'AUD');
  check('audience: new contacts, change, and unsubscribes in the period are counted', F.audience.newContacts === 2 && F.audience.previousPeriodNewContacts === 2 && F.audience.newContactsChangePct === 0 && F.audience.unsubscribedInPeriod === 1 && F.audience.byStatus.subscribed === 3);
  check('flows are counted per status', F.flows.flows[0].enrolled === 3 && F.flows.flows[0].inProgress === 1 && F.flows.flows[0].completed === 2);
  check('social counts what was posted, excludes ad copy, and says engagement is not recorded', F.social.published === 1 && F.social.publishFailed === 1 && F.social.waitingForReview === 1 && F.social.publishedByPlatform.LinkedIn === 1 && /not recorded/.test(F.social.note));
  seed(); db.contacts = db.contacts.filter(c => c.created_at > dAgo(30));
  const Fn = await facts.gatherFacts(sbDirect, { supabaseUrl: 'u', serviceKey: 'k', userId: OWNER, periodDays: 30, now: NOW });
  check('a change from nothing is null, not infinity', Fn.audience.previousPeriodNewContacts === 0 && Fn.audience.newContactsChangePct === null);

  seed(); db.missing = new Set(['email_conversions', 'social_posts']);
  const F2 = await facts.gatherFacts(sbDirect, { supabaseUrl: 'u', serviceKey: 'k', userId: OWNER, periodDays: 30, now: NOW });
  check('a source that is not installed is reported as unavailable, not as zero', F2.revenue.available === false && F2.social.available === false && F2.unavailable.length === 2 && /not installed/.test(F2.revenue.reason));
  seed();
  db.conversions = [{ user_id: OWNER, amount_cents: 100, currency: 'AUD', attribution: 'click', occurred_at: dAgo(1) }, { user_id: OWNER, amount_cents: 100, currency: 'USD', attribution: 'click', occurred_at: dAgo(1) }];
  const F3 = await facts.gatherFacts(sbDirect, { supabaseUrl: 'u', serviceKey: 'k', userId: OWNER, periodDays: 30, now: NOW });
  check('orders in mixed currencies are never added together', F3.revenue.attributedToEmail === undefined && /more than one currency/.test(F3.revenue.note));
  seed(); db.conversions = [];
  const F4 = await facts.gatherFacts(sbDirect, { supabaseUrl: 'u', serviceKey: 'k', userId: OWNER, periodDays: 30, now: NOW });
  check('no orders is "blank, not zero revenue"', F4.revenue.orders === 0 && /not zero revenue/.test(F4.revenue.note));
  const F7 = await facts.gatherFacts(sbDirect, { supabaseUrl: 'u', serviceKey: 'k', userId: OWNER, periodDays: 7, now: NOW });
  check('a 7-day period only sees the last 7 days', F7.email.emailsSent === 4 && F7.period.days === 7 && F7.audience.newContacts === 1);

  console.log('\n──── buildReport: unsupported figures block it ────');
  const { buildReport } = require(path.join(REPO, 'api/_lib/analytics-report.js'));
  seed();
  const good = { title: 'T', summary: 'We sent 4 emails and 66.7% were opened.', sections: [{ heading: 'Email', body: 'Open rate 66.7%.' }], recommendations: ['Turn on click tracking.'] };
  const bad = { ...good, summary: 'Open rate was 47.3%, above the 21% industry average.' };
  let calls = 0;
  let out = await buildReport(F, {}, { write: async () => { calls++; return good; } });
  check('a report quoting only real figures is approved with no second attempt', out.review.approved && calls === 1 && out.review.fixed === false);
  calls = 0;
  out = await buildReport(F, {}, { write: async (f, o) => { calls++; return o.fixList ? good : bad; } });
  check('an unsupported figure triggers ONE rewrite, told exactly which figures', calls === 2 && out.review.approved && out.review.fixed);
  calls = 0; let told = null;
  out = await buildReport(F, {}, { write: async (f, o) => { calls++; told = o.fixList || told; return bad; } });
  check('if the rewrite still invents figures, the report is NOT approved and lists them', !out.review.approved && calls === 2 && out.review.unsupportedNumbers.includes('47.3%') && out.review.unsupportedNumbers.includes('21%') && told.length === 2);
  out = await buildReport(F, {}, { write: async (f, o) => { if (o.fixList) throw new Error('model down'); return bad; } });
  check('if the rewrite cannot run, the first draft stands as not approved', !out.review.approved && out.review.fixed === false);
  let threw = ''; try { await buildReport(F, {}, { write: async () => { throw new Error('boom'); } }); } catch (e) { threw = e.message; }
  check('a failed first draft is an error, not a blank report', threw === 'boom');

  console.log('\n──── the endpoint ────');
  const mod = load('mission-analytics'), arts = load('mission-artifacts');
  const base = { action: 'report', periodDays: 30, projectId: PROJECT };
  seed();
  check('no session is refused', (await call(mod, null, base, true)).statusCode === 401);
  check('an unknown action is refused', (await call(mod, OWNER, { action: 'send' })).statusCode === 400);
  check('a stranger cannot write into someone else\'s business profile', (await call(mod, STRANGER, { ...base, projectId: undefined, intelProfileId: PROFILE })).statusCode === 403);
  check('with no profile or project selected it stops, saying why', (await call(mod, OWNER, { ...base, projectId: undefined })).body.code === 'no_scope');
  check('none of that called the model', writeCalls.length === 0);

  const goodUsing = (a) => ({ title: 'October report', summary: 'We sent 4 emails; 66.7% of recipients opened Spring offer.', sections: [{ heading: 'Email', body: 'Click rate 33.3%.' }], recommendations: ['Turn on open tracking for Newsletter.'] });
  written = goodUsing;
  let r = await call(mod, OWNER, base);
  const art = db.artifacts.find(a => a.id === r.body.artifactId);
  check('a report is drafted, pending approval, with its facts kept', r.body.status === 'drafted' && art.status === 'pending_approval' && art.agent_key === 'analytics' && art.kind === 'analytics_report' && art.payload.facts.email.campaignsSent === 2);
  check('the model is given the facts as the only source', /FACTS \(JSON\)/.test(writeCalls[0].user) && /"campaignsSent": 2/.test(writeCalls[0].user) && /Never state an industry benchmark/.test(writeCalls[0].system));
  check('the review passed', r.body.review.approved === true);
  check('the language and focus reach the writer', (await (async () => { writeCalls.length = 0; await call(mod, OWNER, { ...base, language: 'en-AU', focus: 'email' }); return /Australian English/.test(writeCalls[0].system) && /focus on: email/.test(writeCalls[0].user); })()));

  written = () => ({ title: 'Bad', summary: 'Open rate was 47.3%.', sections: [{ heading: 'x', body: 'y' }], recommendations: ['z'] });
  r = await call(mod, OWNER, base);
  const badArt = db.artifacts.find(a => a.id === r.body.artifactId);
  check('a report with an invented figure is saved as not approved, listing it', r.body.review.approved === false && r.body.review.unsupportedNumbers.includes('47.3%') && badArt.payload.review.approved === false);
  const refuse = await call(arts, OWNER, { action: 'approve', artifactId: badArt.id });
  check('it cannot be approved, and the reason names the figure', refuse.statusCode === 409 && /47\.3%/.test(refuse.body.error) && badArt.status === 'pending_approval' && db.reports.length === 0);
  check('it can still be rejected', (await call(arts, OWNER, { action: 'reject', artifactId: badArt.id })).body.status === 'rejected');

  const modelCallsBefore = writeCalls.length;
  db.sends = []; db.contacts = []; db.conversions = []; db.flows = []; db.posts = [];
  r = await call(mod, OWNER, base);
  check('no marketing activity at all = no model call and no artifact to approve', r.body.status === 'no_data' && /nothing to report/.test(r.body.note) && writeCalls.length === modelCallsBefore);
  written = () => new Error('model down');
  seed();
  check('a model failure is reported, not saved', (await call(mod, OWNER, base)).statusCode === 502);

  console.log('\n──── approve → Report History ────');
  written = goodUsing; seed();
  r = await call(mod, OWNER, { ...base, periodDays: 90 });
  const ok = db.artifacts.find(a => a.id === r.body.artifactId);
  db.failReportInsert = true;
  check('if the save fails the approval is handed back to retry', (await call(arts, OWNER, { action: 'approve', artifactId: ok.id })).statusCode === 502 && ok.status === 'pending_approval');
  db.failReportInsert = false;
  const ap = await call(arts, OWNER, { action: 'approve', artifactId: ok.id });
  const rep = db.reports[0];
  check('approval saves the report to Report History', ap.body.ok && !!ap.body.result.reportId && db.reports.length === 1);
  check('with its scope, a quarterly type for 90 days, and the figures as source data', rep.user_id === OWNER && rep.project_id === PROJECT && rep.report_type === 'quarterly' && JSON.parse(rep.source_data).email.campaignsSent === 3 && /Click rate 33\.3%/.test(rep.content));
  check('it can only be approved once', (await call(arts, OWNER, { action: 'approve', artifactId: ok.id })).statusCode === 409 && db.reports.length === 1);

  console.log('\n──── the shared campaign figures still serve the campaign page ────');
  const cs = load('campaign-stats');
  seed();
  const c1 = await call(cs, OWNER, { campaignId: 'A' });
  check('campaign-stats returns the same figures as before', c1.body.counts.sent === 3 && c1.body.rates.openRate === 66.7 && c1.body.openTracking === 'tracked' && c1.body.revenue.amountCents === 25050);
  const c2 = await call(cs, OWNER, { campaignId: 'B' });
  check('and still says "not recorded" rather than 0%', c2.body.rates.openRate === null && c2.body.openTracking === 'not-recorded' && /off by default/.test(c2.body.notes));
  db.missing = new Set(['rpc/campaign_email_stats']);
  check('and still reports a missing install as 503', (await call(cs, OWNER, { campaignId: 'A' })).statusCode === 503);
  check('a missing campaign id is still a 400', (await call(cs, OWNER, {})).statusCode === 400);

  console.log('\n──── Scotty ────');
  const osrc = fs.readFileSync(path.join(REPO, 'web/js/scotty-orchestrator.js'), 'utf8');
  const orch = new Function('window', 'document', `${osrc}\nreturn window.ScottyOrchestrator;`)({ localStorage: { getItem: () => null, setItem() {}, removeItem() {} } }, { readyState: 'complete', querySelectorAll: () => [], addEventListener() {} });
  check('Analytics is a real executor; video and compliance are not', orch.isRealExecutor('analytics') && !orch.isRealExecutor('video') && !orch.isRealExecutor('video'));
  check('params: period is one of 7/30/90, focus bounded', orch.sanitizeAnalyticsParams({ periodDays: 45 }).periodDays === 30 && orch.sanitizeAnalyticsParams({ periodDays: '7' }).periodDays === 7 && orch.sanitizeAnalyticsParams({ focus: 'x'.repeat(500) }).focus.length === 300);
  const jr = (status, b) => ({ ok: status < 400, status, json: async () => b });
  const reqs = [];
  const task = { params: { periodDays: 30 } };
  const o1 = await orch.runAnalyticsTask(task, { authHeaders: async () => ({}), projectId: PROJECT, language: 'en-AU', businessContext: 'ctx', fetchImpl: async (u, o) => { reqs.push(JSON.parse(o.body)); return jr(200, { status: 'drafted', artifactId: 'a1', title: 'T', markdown: '# T', review: { approved: true, unsupportedNumbers: [] }, unavailable: ['revenue: not installed'], period: { label: 'x' } }); } });
  check('one request carries period, scope, language and context', reqs.length === 1 && reqs[0].action === 'report' && reqs[0].projectId === PROJECT && reqs[0].language === 'en-AU' && o1.complete);
  let again = 0; await orch.runAnalyticsTask(task, { authHeaders: async () => ({}), fetchImpl: async () => { again++; return jr(200, {}); } });
  check('a retry does not write (and pay for) a second report', again === 0);
  const nd = await orch.runAnalyticsTask({ params: {} }, { authHeaders: async () => ({}), fetchImpl: async () => jr(200, { status: 'no_data', note: 'Nothing on record.', facts: { period: { label: 'p' } } }) });
  check('"no data" is reported plainly and there is nothing to approve', nd.noData && /Nothing on record/.test(orch.describeAnalyticsResult(nd)));
  threw = ''; try { await orch.runAnalyticsTask({ params: {} }, { authHeaders: async () => ({}), fetchImpl: async () => jr(409, { error: 'No business profile or project is selected' }) }); } catch (e) { threw = e.message; }
  check('the server\'s reason is what the person sees', /No business profile/.test(threw));
  check('the report text lists what is not available and that figures were checked', /Not available: revenue/.test(orch.describeAnalyticsResult(o1)) && /checked against your data/.test(orch.describeAnalyticsResult(o1)));
  check('an unverified report is described as blocked', /not in your data/.test(orch.describeAnalyticsResult({ title: 'T', review: { approved: false, unsupportedNumbers: ['47.3%'] } })));

  const page = fs.readFileSync(path.join(REPO, 'web/scotty.html'), 'utf8');
  check('the page runs Analytics only for a task the planner marked real', /task\.agentKey === 'analytics' && task\.realExecutor === 'analytics'/.test(page));
  check('the report is shown as text, never as HTML', /<pre[^>]*>\$\{this\._escapeAttr\(real\.markdown\)\}<\/pre>/.test(page));
  check('Approve is only offered for a report that passed the check', /\$\{r\.approved\s*\?\s*`<div class="blade-approval"[\s\S]{0,400}Every figure was checked/.test(page));
  check('approval says nothing is sent or published', /Nothing is sent or published\./.test(page));
  check('the stale Gemini label no longer claims to power analytics', !/analytics:'Gemini 2\.5 Pro'/.test(page));

  console.log(failures === 0 ? '\nALL ASSERTIONS PASSED\n' : `\n${failures} FAILED\n`);
  process.exit(failures === 0 ? 0 : 1);
})();
