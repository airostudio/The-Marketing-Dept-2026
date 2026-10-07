/**
 * Compliance Guard as a real Scotty executor: the rule checks and quote
 * verification (api/_lib/compliance-screen.js), api/mission-compliance.js
 * screening a mission's own outputs, the approve gate on outputs with a
 * critical finding, saving the screen to Report History, the browser module
 * and the page. The screen changes no content and approves nothing.
 *
 *   node tests/mission-compliance/run.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
let failures = 0;
function check(label, ok) { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`); if (!ok) failures++; }
function mockModule(rel, exp) { const p = require.resolve(path.join(REPO, rel)); require.cache[p] = { id: p, filename: p, loaded: true, exports: exp }; }
const clone = (x) => JSON.parse(JSON.stringify(x));

const OWNER = '11111111-1111-1111-1111-111111111111';
const STRANGER = '44444444-4444-4444-4444-444444444444';
const PROFILE = '55555555-5555-5555-5555-555555555555';
const PROJECT = '66666666-6666-6666-6666-666666666666';
const db = { artifacts: [], projects: [{ id: PROJECT, user_id: OWNER }], reports: [] };
let nextId = 1; const uuid = () => `efefefef-efef-efef-efef-${String(nextId++).padStart(12, '0')}`;
const q = (s, k) => { const m = s.match(new RegExp(`[?&]${k}=eq\\.([^&]+)`)); return m ? decodeURIComponent(m[1]) : null; };
const inList = (s, k) => { const m = s.match(new RegExp(`[?&]${k}=in\\.\\(([^)]*)\\)`)); return m ? m[1].split(',') : null; };
let patchLog = [];
mockModule('api/_lib/supabase-rest.js', {
  isUuid: (v) => /^[0-9a-f-]{36}$/i.test(String(v)),
  sbRest: async (u, k, method, p, body) => {
    if (p.startsWith('/intelligence_profiles')) { const id = q(p, 'id'), o = q(p, 'owner_id'); return { ok: true, data: [{ id: PROFILE, owner_id: OWNER }].filter(x => (!id || x.id === id) && (!o || x.owner_id === o)) }; }
    if (p.startsWith('/intelligence_profile_members')) return { ok: true, data: [] };
    if (p.startsWith('/projects')) return { ok: true, data: db.projects.filter(x => x.id === q(p, 'id') && x.user_id === q(p, 'user_id')) };
    if (p.startsWith('/analytics_reports')) { const row = { id: uuid(), ...body }; db.reports.push(row); return { ok: true, data: [row] }; }
    if (p.startsWith('/mission_artifacts')) {
      if (method === 'POST') { const row = { id: uuid(), created_at: new Date().toISOString(), updated_at: new Date(Date.now() - 1000).toISOString(), ...clone(body) }; db.artifacts.push(row); return { ok: true, data: [clone(row)] }; }
      if (method === 'PATCH') {
        patchLog.push(p);
        const id = q(p, 'id'), st = q(p, 'status'), up = q(p, 'updated_at');
        const rows = db.artifacts.filter(a => a.id === id && (!st || a.status === st) && (!up || a.updated_at === up));
        rows.forEach(a => Object.assign(a, clone(body))); return { ok: true, data: clone(rows) };
      }
      const mid = q(p, 'mission_id');
      if (mid) { const kinds = inList(p, 'kind'); const st = q(p, 'status'); return { ok: true, data: clone(db.artifacts.filter(a => a.mission_id === mid && (!st || a.status === st) && (!kinds || kinds.includes(a.kind)))) }; }
      return { ok: true, data: clone(db.artifacts.filter(a => a.id === q(p, 'id'))) };
    }
    return { ok: true, data: [] };
  },
});
mockModule('api/_lib/rate-limit.js', { rateLimited: () => false });
mockModule('api/_lib/report-failure.js', { withFailureReporting: (n, h) => h, reportFailureAsync() {}, reportFailure() {} });
let claudeCalls = []; let reviewImpl = () => ({ findings: [] });
mockModule('api/_lib/nancy-claude.js', { callClaudeForJSON: async (a) => { claudeCalls.push(a); const d = reviewImpl(a); return d instanceof Error ? { success: false, error: d.message } : { success: true, data: d }; }, asUntrustedContent: (t) => `<<${t}>>`, UNTRUSTED_CONTENT_RULE: 'UNTRUSTED' });
global.fetch = async (url) => (String(url).includes('/auth/v1/user') && global.__callerId) ? { ok: true, json: async () => ({ id: global.__callerId }) } : { ok: false };
Object.assign(process.env, { SUPABASE_URL: 'https://x.test', SUPABASE_SERVICE_ROLE_KEY: 'svc', ANTHROPIC_API_KEY: 'k' });
function load(n) { const p = path.join(REPO, `api/${n}.js`); delete require.cache[require.resolve(p)]; return require(p); }
function res() { const r = { statusCode: 200 }; r.status = (c) => { r.statusCode = c; return r; }; r.json = (d) => { r.body = d; return r; }; r.setHeader = () => {}; r.end = () => r; return r; }
async function call(h, who, body, noAuth) { global.__callerId = who; const r = res(); await h({ method: 'POST', headers: noAuth ? {} : { authorization: 'Bearer t' }, body }, r); return r; }

(async () => {
  const cs = require(path.join(REPO, 'api/_lib/compliance-screen.js'));
  console.log('\n──── the rule checks ────');
  const piece = (text, extra) => ({ id: 'a:x', artifactId: 'a', text, channel: 'social', ...(extra || {}) });
  const codes = (text, ctx, extra) => cs.codeFindings(piece(text, extra), { region: 'US', ...(ctx || {}) });
  const has = (fs_, sev, quote) => fs_.some(f => f.severity === sev && f.quote.toLowerCase() === quote.toLowerCase());
  check('an unfilled placeholder is critical', has(codes('Hi [First Name], welcome.'), 'critical', '[First Name]'));
  check('a markdown link is not mistaken for a placeholder', codes('Read [our guide](https://x.com/g) today.').length === 0);
  check('a phrase the Business Brain bans is critical, quoted as written', has(codes('We offer World-Class Service.', { neverSay: ['world-class service'] }), 'critical', 'World-Class Service'));
  check('a named competitor is a warning', has(codes('Better than Acme Plumbing.', { competitorNames: ['Acme Plumbing'] }), 'warning', 'Acme Plumbing'));
  check('a competitor name inside another word is not', codes('Acmeplumbingly done.', { competitorNames: ['Acme'] }).length === 0);
  for (const t of ['#1', 'guaranteed', 'risk-free', 'clinically proven', 'best in town', 'cheapest']) check(`"${t}" is flagged as a claim needing proof`, has(codes(`We are ${t} for you.`), 'warning', t));
  check('"#12" is not "#1"', codes('Issue #12 is out.').length === 0);
  check('a promised financial return is critical', has(codes('Guaranteed returns every month.'), 'critical', 'Guaranteed returns'));
  check('…and not reported twice as a plain "guaranteed"', codes('Guaranteed returns every month.').length === 1);
  check('a medical cure claim is critical', has(codes('Our tea cures anxiety.'), 'critical', 'cures anxiety'));
  check('plain, honest copy raises nothing', codes('We fix leaking taps in Leeds. Call us on weekdays.').length === 0);
  const cold = { channel: 'email', meta: { audienceTags: ['blade-prospect', 'plumbers'] } };
  check('cold email to people who never opted in is flagged in the UK, naming PECR', codes('Subject: Hi\n\nBody', { region: 'UK' }, cold).some(f => /PECR/.test(f.rule) && f.quote === 'Subject: Hi'));
  check('…but not in the US, where the footer covers CAN-SPAM', codes('Subject: Hi\n\nBody', { region: 'US' }, cold).length === 0);
  check('an AI video gets an AI-label suggestion', codes('A baker at dawn', {}, { channel: 'video' }).some(f => f.severity === 'suggestion' && /AI/.test(f.issue)));

  console.log('\n──── what gets screened from each output ────');
  const art = (kind, payload) => ({ id: 'A', kind, payload });
  check('Pat: subject and plain text', cs.extractPieces(art('pat_campaign', { subject: 'S', text: 'Body', params: { audienceTags: ['x'] } }))[0].text === 'Subject: S\n\nBody');
  check('social: each post with its hashtags', cs.extractPieces(art('social_posts', { posts: [{ platform: 'LinkedIn', body: 'P', hashtags: ['a'] }, { platform: 'X', body: 'Q' }] })).map(p => p.text).join('|') === 'P\n\n#a|Q');
  check('Nancy: image text, caption and call to action', /Image text: H[\s\S]*Cap[\s\S]*Go/.test(cs.extractPieces(art('nancy_week', { posts: [{ day: 1, slide_headline: 'H', caption: 'Cap', cta: 'Go' }] }))[0].text));
  check('ads: headline, body, description and CTA', /Headline: H\nB\nDescription: D\nCTA: C/.test(cs.extractPieces(art('ad_campaign', { variants: [{ platform: 'Meta', headline: 'H', body: 'B', description: 'D', cta: 'C' }] }))[0].text));
  check('SEO: the article itself', /Body md/.test(cs.extractPieces(art('seo_plan', { articles: [{ title: 'T', body_markdown: 'Body md' }] }))[0].text));
  check('LinkedIn: only the drafts that will be used', cs.extractPieces(art('linkedin_drafts', { drafts: [{ name: 'A', usable: true, connectionNote: 'n', followUp: 'f' }, { name: 'B', usable: false, connectionNote: 'x', followUp: 'y' }] })).length === 1);
  check('a kind with nothing to publish yields nothing', cs.extractPieces(art('chase_audit', { leads: [] })).length === 0);

  console.log('\n──── the review must quote real words ────');
  const pieces = [{ id: 'A:p', artifactId: 'A', text: 'We’re the friendliest plumbers — call now, only 3 slots left!' }];
  const v = cs.verifyFindings([
    { pieceId: 'A:p', severity: 'warning', quote: "We're the friendliest plumbers", issue: 'Superlative', rule: 'r', fix: 'We are friendly plumbers' },
    { pieceId: 'A:p', severity: 'critical', quote: 'free boiler for life', issue: 'Invented', rule: 'r', fix: '' },
    { pieceId: 'Z:p', severity: 'warning', quote: 'call now', issue: 'x', rule: 'r', fix: '' },
    { pieceId: 'A:p', severity: 'loud', quote: 'call now', issue: 'x', rule: 'r', fix: '' },
    { pieceId: 'A:p', severity: 'warning', quote: 'only 3 slots left', issue: 'Scarcity needs to be true', rule: '', fix: 'Only 40% of slots left' },
  ], pieces);
  check('a quote that matches (curly apostrophes, dashes) is kept', v.kept.some(f => f.quote.startsWith("We're")));
  check('a quote that is not in the content, an unknown piece and a made-up severity are dropped and counted', v.dropped === 3 && v.kept.length === 2);
  check('a suggested fix that adds a figure the content never had is removed; the finding stays', v.kept[1].quote === 'only 3 slots left' && v.kept[1].fix === '' && v.kept[1].rule === 'General advertising standards');

  let r = await cs.screen([{ id: 'A:p', artifactId: 'A', kind: 'social_posts', label: 'L', channel: 'social', text: 'Plain copy here.' }], { region: 'US' }, { review: async () => { throw new Error('model down'); } });
  check('if the review cannot run, the result says "rule checks only", never "no issues found"', r.pieces[0].verdict === 'rules_only' && /model down/.test(r.reviewError));
  r = await cs.screen([{ id: 'A:p', artifactId: 'A', kind: 'k', label: 'L', channel: 'social', text: 'We are #1 in Leeds.' }], { region: 'US' }, { review: async () => [{ pieceId: 'A:p', severity: 'warning', quote: '#1', issue: 'dup', rule: 'r', fix: '' }] });
  check('the same words flagged by a rule and by the review are one finding', r.findings.length === 1 && r.findings[0].source === 'rule');

  console.log('\n──── the endpoint ────');
  const mod = load('mission-compliance'), arts = load('mission-artifacts');
  const M = 'mission_abc';
  const mk = (row) => { const a = { id: uuid(), created_at: new Date().toISOString(), updated_at: '2026-01-01T00:00:00.000Z', mission_id: M, status: 'pending_approval', intel_profile_id: null, ...row }; db.artifacts.push(a); return a; };
  const pat = mk({ user_id: OWNER, agent_key: 'delivery', kind: 'pat_campaign', title: 'Email', payload: { subject: 'Quick idea for Smith Plumbing', text: 'Hi [First Name], our websites are guaranteed to double your calls.', params: { audienceTags: ['blade-prospect'] }, review: { approved: true } } });
  const li = mk({ user_id: OWNER, agent_key: 'linkedin', kind: 'linkedin_drafts', title: 'LI', payload: { drafts: [{ id: 'p1', name: 'Jane', usable: true, connectionNote: 'Hi Jane, we offer guaranteed returns on ads.', followUp: 'Thanks for connecting.' }] } });
  const clean = mk({ user_id: OWNER, agent_key: 'linkedin', kind: 'linkedin_drafts', title: 'LI clean', payload: { drafts: [{ id: 'p1', name: 'Sam', usable: true, connectionNote: 'Hi Sam, I build websites for trades. Good to connect.', followUp: 'Thanks for connecting, Sam.' }] } });
  const done = mk({ user_id: OWNER, agent_key: 'social', kind: 'social_posts', title: 'Old', status: 'approved', payload: { posts: [{ platform: 'LinkedIn', body: 'Old post' }] } });
  const theirs = mk({ user_id: STRANGER, agent_key: 'social', kind: 'social_posts', title: 'Theirs', payload: { posts: [{ platform: 'LinkedIn', body: 'Stranger post' }] } });

  check('no session is refused', (await call(mod, null, { action: 'review', missionId: M }, true)).statusCode === 401);
  check('an unknown action is refused', (await call(mod, OWNER, { action: 'approve' })).statusCode === 400);
  check('with no profile or project it stops, saying why', (await call(mod, OWNER, { action: 'review', missionId: M })).body.code === 'no_scope');
  const empty = await call(mod, OWNER, { action: 'review', missionId: 'mission_none', projectId: PROJECT });
  check('nothing to screen is a question back, before any model call', empty.body.status === 'needs_input' && empty.body.questions[0].field === 'content' && claudeCalls.length === 0);

  reviewImpl = (a) => ({ findings: [{ pieceId: `${pat.id}:email`, severity: 'warning', quote: 'double your calls', issue: 'A result claim needs evidence.', rule: 'FTC Act s.5', fix: 'help more customers find you' }, { pieceId: `${pat.id}:email`, severity: 'critical', quote: 'free for life', issue: 'invented', rule: 'x', fix: '' }] });
  const out = await call(mod, OWNER, { action: 'review', missionId: M, projectId: PROJECT, region: 'UK', industry: 'Web design', neverSay: ['cheap websites'], competitorNames: ['Wix'], content: 'Cheap websites, best in town.' });
  const ids = (out.body.pieces || []).map(p => p.artifactId);
  check('it screens this mission\'s outputs still waiting for approval, plus the pasted content', out.body.status === 'reviewed' && ids.includes(pat.id) && ids.includes(li.id) && ids.includes(clean.id) && ids.includes(null));
  check('already-approved outputs and other people\'s outputs are not screened', !ids.includes(done.id) && !ids.includes(theirs.id));
  const sent = claudeCalls[claudeCalls.length - 1];
  check('the review gets region, industry, brand rules and competitors, with the content fenced as data', /REGION: UK/.test(sent.user) && /Web design/.test(sent.user) && /cheap websites/.test(sent.user) && /COMPETITORS: Wix/.test(sent.user) && /<<Subject: Quick idea for Smith Plumbing/.test(sent.user) && /UNTRUSTED/.test(sent.system));
  check('the review is told every finding must quote exact words and never to invent a regulation', /MUST quote the exact words/.test(sent.system) && /Never invent a regulation/.test(sent.system));
  const f = out.body.findings;
  check('rule findings: placeholder, absolute claim, UK cold-email consent', f.some(x => x.quote === '[First Name]' && x.severity === 'critical') && f.some(x => x.quote.toLowerCase() === 'guaranteed') && f.some(x => /PECR/.test(x.rule)));
  check('a review finding that quotes real words is kept; one that does not is dropped and counted', f.some(x => x.quote === 'double your calls' && x.source === 'review') && !f.some(x => x.quote === 'free for life') && out.body.droppedUnverified === 1);
  check('the pasted content is screened against the brand rules', f.some(x => x.pieceId === 'pasted:content' && x.quote === 'Cheap websites' && x.severity === 'critical'));
  check('critical findings come first', f[0].severity === 'critical');
  const review = db.artifacts.find(a => a.id === out.body.artifactId);
  check('the screen is saved as a compliance review awaiting approval, marked not legal advice', review.kind === 'compliance_review' && review.agent_key === 'compliance' && review.status === 'pending_approval' && review.payload.notLegalAdvice === true && review.mission_id === M);
  check('each screened output is marked with its verdict', db.artifacts.find(a => a.id === pat.id).payload.compliance.verdict === 'needs_changes' && db.artifacts.find(a => a.id === li.id).payload.compliance.critical === 1 && db.artifacts.find(a => a.id === clean.id).payload.compliance.verdict === 'no_issues_found');
  check('the mark keeps the output\'s own content untouched', db.artifacts.find(a => a.id === pat.id).payload.text === pat.payload.text && db.artifacts.find(a => a.id === pat.id).status === 'pending_approval');
  check('marking is conditional on the output not having changed since it was read', patchLog.every(p => /updated_at=eq\./.test(p) && /status=eq\.pending_approval/.test(p)));
  check('the response lists each output\'s verdict', out.body.reviewed.find(x => x.artifactId === li.id).verdict === 'needs_changes' && out.body.unmarked.length === 0);

  console.log('\n──── approving an output the screen flagged ────');
  const g = await call(arts, OWNER, { action: 'approve', artifactId: li.id });
  check('an output with a critical finding is not approved without a confirmed read', g.statusCode === 409 && g.body.code === 'compliance_flags' && /guaranteed returns/i.test(g.body.findings[0].quote) && db.artifacts.find(a => a.id === li.id).status === 'pending_approval');
  const g2 = await call(arts, OWNER, { action: 'approve', artifactId: li.id, acknowledgeCompliance: true });
  check('once the person confirms, it is approved and the confirmation is recorded', g2.body.ok && db.artifacts.find(a => a.id === li.id).payload.approval.complianceAcknowledged === true);
  const g3 = await call(arts, OWNER, { action: 'approve', artifactId: clean.id });
  check('an output with nothing critical approves as normal', g3.body.ok && !db.artifacts.find(a => a.id === clean.id).payload.approval.complianceAcknowledged);
  const g4 = await call(arts, OWNER, { action: 'reject', artifactId: pat.id });
  check('rejecting a flagged output needs no confirmation', g4.body.status === 'rejected');
  const ls = await call(arts, OWNER, { action: 'get', artifactId: li.id });
  check('the verdict travels with the output in the artifact summary', ls.body.artifact.compliance.verdict === 'needs_changes');

  console.log('\n──── approving the screen ────');
  const ar = await call(arts, OWNER, { action: 'approve', artifactId: review.id });
  const rep = db.reports[db.reports.length - 1];
  check('the screen goes to Report History as a compliance report, scoped to the project', ar.body.ok && rep.report_type === 'compliance' && rep.project_id === PROJECT);
  check('the report keeps the not-legal-advice line and every finding with its quote', /not legal advice/.test(rep.content) && /“double your calls”/.test(rep.content) && /Rule: FTC Act s\.5/.test(rep.content));
  check('approving the screen approves nothing else', db.artifacts.filter(a => a.status === 'approved').map(a => a.id).sort().join() === [li.id, clean.id, done.id, review.id].sort().join());

  console.log('\n──── the browser module ────');
  const cm = require(path.join(REPO, 'web/js/compliance-mission.js'));
  check('region from a fixed list, Global by default', cm.sanitizeParams({ region: 'Mars' }).region === 'Global' && cm.sanitizeParams({ region: 'UK' }).region === 'UK');
  check('it needs something to screen: another agent\'s output, or pasted content', cm.missingInputs({}, ['blade']).length === 1 && cm.missingInputs({}, ['blade', 'delivery']).length === 0 && cm.missingInputs({ content: 'x' }, []).length === 0);
  check('the plan line names what will be screened', /Pat's email, ad copy/.test(cm.describeParams({ region: 'UK' }, ['delivery', 'ads'])));
  const jr = (st, b) => ({ ok: st < 400, status: st, json: async () => b });
  const reqs = []; const task = { params: { region: 'UK' } };
  const o = await cm.runCompliance(task, { authHeaders: async () => ({}), missionId: M, projectId: PROJECT, industry: 'Web', neverSay: ['cheap'], competitorNames: ['Wix'], fetchImpl: async (u, op) => { reqs.push(JSON.parse(op.body)); return jr(200, { status: 'reviewed', artifactId: 'r1', region: 'UK', counts: { critical: 1 }, pieces: [{ label: 'Email', verdict: 'needs_changes' }], findings: [] }); } });
  check('one request carries the mission, region, industry, brand rules and competitors', reqs.length === 1 && reqs[0].missionId === M && reqs[0].region === 'UK' && reqs[0].neverSay[0] === 'cheap' && reqs[0].competitorNames[0] === 'Wix' && o.complete);
  let again = 0; await cm.runCompliance(task, { authHeaders: async () => ({}), fetchImpl: async () => { again++; return jr(200, {}); } });
  check('a retry does not screen (and pay) again', again === 0);
  let threw = ''; try { await cm.runCompliance({ params: {} }, { authHeaders: async () => ({}), fetchImpl: async () => jr(200, { status: 'needs_input', questions: [{ question: 'There is nothing to screen yet' }] }) }); } catch (e) { threw = e.message; }
  check('a question from the server surfaces, not a made-up all-clear', /nothing to screen/.test(threw));
  const d = cm.describeResult({ region: 'UK', counts: { critical: 1, warnings: 0, suggestions: 0 }, pieces: [{ label: 'Email', verdict: 'needs_changes' }], reviewError: 'down', droppedUnverified: 2 });
  check('the report says it is not legal advice, changes nothing, and owns up to a review that did not run', /not legal advice/.test(d) && /Nothing was changed or approved/.test(d) && /could not run/.test(d) && /2 further findings were left out/.test(d));

  console.log('\n──── Scotty ────');
  const osrc = fs.readFileSync(path.join(REPO, 'web/js/scotty-orchestrator.js'), 'utf8');
  const orch = new Function('window', 'document', `${osrc}\nreturn window.ScottyOrchestrator;`)({ localStorage: { getItem: () => null, setItem() {}, removeItem() {} } }, { readyState: 'complete', querySelectorAll: () => [], addEventListener() {} });
  check('Compliance Guard is a real executor; deck is not', orch.isRealExecutor('compliance') && !orch.isRealExecutor('deck') && !orch.isRealExecutor('compliance-automation'));
  if (orch.orderForExecution) {
    check('it always runs last, after the agents whose work it screens', JSON.stringify(orch.orderForExecution(['compliance', 'delivery', 'blade', 'social'])) === JSON.stringify(['blade', 'delivery', 'social', 'compliance']));
  } else check('orderForExecution is exported', false);
  check('the planner only marks it real when the module is loaded', /agentKey === 'compliance' && window\.ComplianceMission/.test(osrc));
  const eng = fs.readFileSync(path.join(REPO, 'web/js/intelligence-engine.js'), 'utf8');
  const nsp = new Function(`${eng.match(/function neverSayPhrases[\s\S]*?\n}\n/)[0]}; return neverSayPhrases;`)();
  check('banned phrases are read out of the free-text Business Brain field', JSON.stringify(nsp("- 'World-class service' (generic)\nDon't say 'synergy'\n- cheap")) === JSON.stringify(['World-class service', 'synergy', 'cheap']));
  check('the context bundle carries industry, banned phrases and competitor names', /industry:\s+\(this\.brain/.test(eng) && /neverSay:\s+neverSayPhrases/.test(eng) && /competitorNames:/.test(eng));
  const page = fs.readFileSync(path.join(REPO, 'web/scotty.html'), 'utf8');
  check('the page runs it only for a task the planner marked real', /task\.agentKey === 'compliance' && task\.realExecutor === 'compliance'/.test(page) && /<script src="\/js\/compliance-mission\.js">/.test(page));
  check('the start gate needs something to screen', /ComplianceMission\.missingInputs\(t\.params, producers\)/.test(page));
  check('findings and quotes are escaped on screen', /_renderComplianceResult[\s\S]*_escapeAttr\(f\.quote\)[\s\S]*_escapeAttr\(f\.issue\)[\s\S]*_escapeAttr\(f\.fix\)/.test(page));
  check('the result says it is a screen, not legal advice', /_renderComplianceResult[\s\S]*AI-assisted screen, not legal advice/.test(page));
  check('approving a flagged output asks the person to confirm, then sends the confirmation', /data\.code === 'compliance_flags'/.test(page) && /window\.confirm\(/.test(page) && /acknowledgeCompliance: true/.test(page));
  check('the stale "Claude Opus 4.7" label is gone', !/compliance:'Claude Opus 4\.7'/.test(page));

  console.log(failures === 0 ? '\nALL ASSERTIONS PASSED\n' : `\n${failures} FAILED\n`);
  process.exit(failures === 0 ? 0 : 1);
})();
