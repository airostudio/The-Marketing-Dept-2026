/**
 * Scotty running Blade for REAL. A mission task used to be a Claude chat
 * completion describing what an agent would do; Blade is the first agent
 * whose task actually runs its pipeline and leaves a real, approvable
 * artifact behind. This checks the pieces that make that safe and honest:
 * the plan never invents a city, the real run refuses to start without its
 * inputs, a retry resumes instead of paying for the search twice, a stalled
 * lookup is a failure rather than a fake success, and the page wires an
 * explicit approval instead of importing anything on its own.
 *
 *   node tests/scotty-blade-executor/run.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
let failures = 0;
function check(label, ok) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failures++;
}

const src = fs.readFileSync(path.join(REPO, 'web/js/scotty-orchestrator.js'), 'utf8');
function loadOrchestrator(win) {
  const fakeDocument = { readyState: 'complete', querySelectorAll: () => [], addEventListener: () => {} };
  const fn = new Function('window', 'document', `${src}\nreturn window.ScottyOrchestrator;`);
  return fn({ localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, ...win }, fakeDocument);
}

const authHeaders = async () => ({ 'Content-Type': 'application/json', Authorization: 'Bearer t' });
function jsonRes(status, body) { return { ok: status < 400, status, json: async () => body }; }

(async () => {
  const orch = loadOrchestrator({});

  console.log('\n──── Blade is a registered agent, and the only one that runs for real ────');
  check('Scotty can route to Blade', orch.AGENT_ROUTES.blade === '/agents/blade-agent.html');
  check('Blade is a real executor', orch.isRealExecutor('blade') === true);
  check('agents without a real pipeline still run as before — sales, email, seo are not real executors',
    ['sales', 'email', 'seo'].every(k => orch.isRealExecutor(k) === false));

  console.log('\n──── the inputs: trimmed, bounded, and missing means missing ────');
  check('sanitising trims and collapses whitespace', JSON.stringify(orch.sanitizeBladeParams({ sector: '  dental   clinics ', city: ' Austin ', country: '' })) === '{"sector":"dental clinics","city":"Austin","country":""}');
  check('a non-object becomes all-blank rather than throwing', JSON.stringify(orch.sanitizeBladeParams(null)) === '{"sector":"","city":"","country":""}');
  check('an absurdly long value is capped', orch.sanitizeBladeParams({ sector: 'x'.repeat(500) }).sector.length === 80);
  check('a blank trade and city are both reported missing', orch.missingBladeInputs({}).length === 2);
  check('country is optional — a trade and city are enough', orch.missingBladeInputs({ sector: 'plumbers', city: 'Austin' }).length === 0);

  console.log('\n──── the real run refuses to start without its inputs, spending nothing ────');
  {
    let calls = 0;
    const fetchImpl = async () => { calls++; return jsonRes(200, {}); };
    let err;
    try { await orch.runBladeTask({ params: { sector: 'plumbers', city: '' } }, { authHeaders, fetchImpl }); } catch (e) { err = e; }
    check('it throws a plain explanation', !!err && /needs the city or area/.test(err.message));
    check('and made no request at all', calls === 0);
  }

  console.log('\n──── the real run: discover once, then enrich in batches until none remain ────');
  {
    const calls = [];
    const leadsAll = [1, 2, 3, 4, 5, 6, 7].map(n => ({ placeId: `p${n}`, name: `B${n}`, enriched: false, email: null }));
    let enrichedCount = 0;
    const fetchImpl = async (url, opts) => {
      const body = JSON.parse(opts.body);
      calls.push(body);
      if (body.action === 'discover') return jsonRes(200, { artifactId: 'art-1', status: 'building', stats: { candidatesChecked: 30, query: 'q' }, leads: leadsAll.map(l => ({ ...l })), remaining: 7 });
      const take = Math.min(5, 7 - enrichedCount);
      const batch = leadsAll.slice(enrichedCount, enrichedCount + take).map(l => ({ ...l, enriched: true, email: `${l.placeId}@x.com` }));
      enrichedCount += take;
      const remaining = 7 - enrichedCount;
      return jsonRes(200, { processed: take, remaining, status: remaining ? 'building' : 'pending_approval', leads: batch });
    };
    const statuses = [];
    const task = { params: { sector: 'plumbers', city: 'Austin', country: 'USA' } };
    const result = await orch.runBladeTask(task, { authHeaders, fetchImpl, intelProfileId: 'prof-1', missionId: 'mission_1', onStatus: (m) => statuses.push(m) });
    check('one discover call, then two enrich calls', calls.map(c => c.action).join(',') === 'discover,enrich,enrich');
    check('the profile and mission are passed on, so the artifact is shared and traceable', calls[0].intelProfileId === 'prof-1' && calls[0].missionId === 'mission_1');
    check('the artifact id from discover drives every enrich call', calls.slice(1).every(c => c.artifactId === 'art-1'));
    check('enriched leads are merged back into the full list', result.leads.length === 7 && result.leads.every(l => l.enriched && l.email));
    check('it finishes in the approvable state', result.complete === true && result.status === 'pending_approval');
    check('progress is reported while it runs', statuses.some(s => /Searching Google/.test(s)) && statuses.some(s => /contact details/.test(s)));
  }

  console.log('\n──── a retry resumes the same list instead of searching (and paying) again ────');
  {
    let discoverCalls = 0, enrichCalls = 0;
    const fetchImpl = async (url, opts) => {
      const body = JSON.parse(opts.body);
      if (body.action === 'discover') { discoverCalls++; return jsonRes(200, { artifactId: 'art-2', status: 'building', stats: {}, leads: [{ placeId: 'p1', enriched: false }], remaining: 1 }); }
      enrichCalls++;
      if (enrichCalls === 1) return jsonRes(502, { error: 'upstream blip' });
      return jsonRes(200, { processed: 1, remaining: 0, status: 'pending_approval', leads: [{ placeId: 'p1', enriched: true, email: 'a@b.co' }] });
    };
    const task = { params: { sector: 'plumbers', city: 'Austin' } };
    let first;
    try { await orch.runBladeTask(task, { authHeaders, fetchImpl }); } catch (e) { first = e; }
    check('the first attempt fails with the server\'s own message', !!first && /upstream blip/.test(first.message));
    const second = await orch.runBladeTask(task, { authHeaders, fetchImpl });
    check('the retry does not search again', discoverCalls === 1);
    check('it carries on enriching the same artifact and completes', second.complete && second.artifactId === 'art-2' && second.leads[0].email === 'a@b.co');
  }

  console.log('\n──── a lookup that stops advancing is a failure, not a fake success ────');
  {
    const fetchImpl = async (url, opts) => {
      const body = JSON.parse(opts.body);
      if (body.action === 'discover') return jsonRes(200, { artifactId: 'art-3', status: 'building', stats: {}, leads: [{ placeId: 'p1' }, { placeId: 'p2' }], remaining: 2 });
      return jsonRes(200, { processed: 0, remaining: 2, status: 'building', leads: [] });
    };
    let err;
    try { await orch.runBladeTask({ params: { sector: 'a', city: 'b' } }, { authHeaders, fetchImpl }); } catch (e) { err = e; }
    check('it throws instead of returning something that looks done', !!err && /stalled with 2 leads/.test(err.message));
  }

  console.log('\n──── an empty result is reported plainly, with no approval to give ────');
  {
    const fetchImpl = async () => jsonRes(200, { artifactId: 'art-4', status: 'empty', stats: { candidatesChecked: 12, query: 'q' }, leads: [], remaining: 0, note: 'none qualified' });
    const result = await orch.runBladeTask({ params: { sector: 'a', city: 'b' } }, { authHeaders, fetchImpl });
    check('no leads, and the server\'s reason carried through', result.leads.length === 0 && result.note === 'none qualified');
    check('the report says so rather than inventing a list', /none qualified/.test(orch.describeBladeResult(result)));
  }

  console.log('\n──── the report describes what was really found, and what has NOT happened ────');
  {
    const md = orch.describeBladeResult({ stats: { query: 'plumbers in Austin', candidatesChecked: 30, noWebsite: 2, builderLocked: 1 }, complete: true, leads: [
      { name: 'A Co', siteStatus: 'no_website', email: 'a@a.co', ownerFirstName: 'Sam' },
      { name: 'B Co', siteStatus: 'outdated', sitePlatform: 'wix', email: null, ownerFirstName: '' },
    ] });
    check('states it ran for real and what it searched', /ran for real/.test(md) && /plumbers in Austin/.test(md));
    check('reports only the contact details actually found', /1 email, 1 owner name/.test(md));
    check('says blanks are blanks, not guesses', /not found is left blank|left blank, not guessed/.test(md));
    check('is explicit that nothing has been imported or sent', /nothing has been imported or sent/.test(md));
  }

  console.log('\n──── mission planning: the plan never invents where to search ────');
  {
    const seenSystemPrompts = [];
    const win = {
      ClaudeService: {
        streamResponse: async ({ systemPrompt }) => {
          seenSystemPrompts.push(systemPrompt);
          if (/selecting which specialist agents/.test(systemPrompt)) {
            return JSON.stringify({ missionTitle: 'Win local trades', missionSummary: 'Find plumbers.', agentKeys: ['blade', 'email'], channelMix: [] });
          }
          if (/ONE task for Blade/.test(systemPrompt)) {
            // The goal never named a city — a model that obeys returns blank.
            return JSON.stringify({ taskName: 'Find plumbers', objective: 'Reach plumbers with dated sites', params: { sector: 'plumbers', city: '', country: '' } });
          }
          return JSON.stringify({ taskName: 'Write the email', objective: 'o', userPrompt: 'Write a 3 email sequence.' });
        },
      },
    };
    const o2 = loadOrchestrator(win);
    const plan = await o2.generateMissionPlan('Get me plumber customers', { isReady: false });
    const bladeTask = plan.tasks.find(t => t.agentKey === 'blade');
    const emailTask = plan.tasks.find(t => t.agentKey === 'email');
    check('Blade gets a structured, real-executor task', bladeTask.realExecutor === 'blade' && bladeTask.params.sector === 'plumbers');
    check('a city the goal never stated stays blank, to be asked for — not guessed', bladeTask.params.city === '');
    check('other agents are planned exactly as before', !emailTask.realExecutor && emailTask.userPrompt === 'Write a 3 email sequence.');
    const bladePrompt = seenSystemPrompts.find(p => /ONE task for Blade/.test(p));
    check('the instruction forbids guessing a place', /never guess/i.test(bladePrompt) && /empty string/.test(bladePrompt));
    const selectPrompt = seenSystemPrompts.find(p => /selecting which specialist agents/.test(p));
    check('selection knows about Blade and prefers it for local prospecting', /- blade:/.test(selectPrompt) && /use "blade" instead of "sales"/.test(selectPrompt));
  }

  console.log('\n──── the page: explicit approval, real-run branch, safe inputs ────');
  {
    const page = fs.readFileSync(path.join(REPO, 'web/scotty.html'), 'utf8');
    check('a real-executor task runs the real pipeline, not the Claude write-up', /orch\.isRealExecutor\(task\.agentKey\)/.test(page) && /orch\.runBladeTask\(task/.test(page));
    check('Start Mission is blocked until the inputs are real', /missingBladeInputs\(t\.params\)[\s\S]{0,400}before the mission can start[\s\S]{0,200}return;/.test(page));
    check('the user can edit the trade and place before anything runs', /data-param="sector"/.test(page) && /data-param="city"/.test(page));
    check('approving is an explicit click that calls the approve endpoint', /class="mission-report-btn primary blade-approve"/.test(page) && /\/api\/mission-artifacts/.test(page));
    check('the page itself never imports anything — only the server does, on approve', !/\/rest\/v1\/contacts|ContactsStore\.(upsert|add|create)/.test(page.slice(page.indexOf('_renderBladeResult'), page.indexOf('_wireArtifactDecision') + 3000)));
    check('param values go into attributes through the quote-safe escaper', /value="\$\{this\._escapeAttr\(/.test(page) && !/value="\$\{this\._escapeHtml\(\(t\.params/.test(page));
    check('Blade is registered in the page\'s mission registries', /blade:'🗡️'/.test(page) && /blade:'\/agents\/blade-agent\.html'/.test(page));
  }

  console.log('\n──── the result panel actually works: renders safely, approval calls the server and reports honestly ────');
  {
    const page = fs.readFileSync(path.join(REPO, 'web/scotty.html'), 'utf8');
    // Run the page's real methods inside a class, against a stand-in for the
    // one thing they lean on that needs a DOM (_escapeHtml). Everything else
    // under test is the page's own source, verbatim.
    const methodsSrc = page.slice(page.indexOf('    _renderBladeResult(resultEl, real) {'), page.indexOf('    /* ── CHAIN ACTIONS'));
    const escapeAttrStart = page.indexOf('    _escapeAttr(str) {');
    const escapeAttrSrc = page.slice(escapeAttrStart, page.indexOf('\n    }\n', escapeAttrStart) + 6);
    const factory = new Function('window', 'fetch', `
      class Host {
        _escapeHtml(str) { return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
${escapeAttrSrc}
${methodsSrc}
      }
      return new Host();`);

    const handlers = {};
    const mkBtn = (cls) => ({ disabled: false, addEventListener: (ev, fn) => { handlers[cls] = fn; } });
    const approveBtn = mkBtn('approve'), rejectBtn = mkBtn('reject');
    const msg = { textContent: '', innerHTML: '' };
    const box = { querySelector: (sel) => ({ '.blade-approve': approveBtn, '.blade-reject': rejectBtn, '.blade-approval-msg': msg })[sel] };
    const resultEl = { innerHTML: '', querySelector: (sel) => (sel === '.blade-approval' ? box : null) };

    let fetched = null;
    let fetchResult = { ok: true, status: 200, json: async () => ({ ok: true, status: 'approved', result: { imported: 5, skippedExisting: 1, skippedNoEmail: 2, failed: 0 } }) };
    const host = factory({ sendAuthHeaders: async () => ({ Authorization: 'Bearer t' }) }, async (url, opts) => { fetched = { url, body: JSON.parse(opts.body) }; return fetchResult; });

    const hostile = '<img src=x onerror=alert(1)>"\'';
    host._renderBladeResult(resultEl, {
      artifactId: 'art-9', stats: { candidatesChecked: 30 },
      leads: [{ name: hostile, siteStatus: 'outdated', sitePlatform: null, email: 'a@b.co', ownerFirstName: hostile, phone: '555' }, { name: 'Plain', siteStatus: 'no_website', email: null, ownerFirstName: '' }],
    });
    check('a hostile business name from a website cannot inject markup', !/<img src=x/.test(resultEl.innerHTML) && /&lt;img/.test(resultEl.innerHTML));
    check('the panel says approving adds only the ones with a real email', /Approve — add 1 to audience/.test(resultEl.innerHTML));
    check('and that it sends nothing', /sends nothing/i.test(resultEl.innerHTML));

    await handlers.approve();
    check('approving calls the server\'s approve action for exactly this artifact', fetched.url === '/api/mission-artifacts' && fetched.body.action === 'approve' && fetched.body.artifactId === 'art-9');
    check('the outcome is reported in full — added, already there, and the ones with no email', /5 added/.test(msg.innerHTML) && /1 already there/.test(msg.innerHTML) && /2 had no email found/.test(msg.innerHTML));
    check('the buttons stay disabled after a successful decision', approveBtn.disabled && rejectBtn.disabled);

    approveBtn.disabled = rejectBtn.disabled = false;
    fetchResult = { ok: false, status: 409, json: async () => ({ error: 'Someone else already decided this.' }) };
    await handlers.approve();
    check('a refusal is shown as the server\'s own words, not a fake success', /Could not approve: Someone else already decided this\./.test(msg.textContent));
    check('and the buttons come back so it can be retried', !approveBtn.disabled && !rejectBtn.disabled);

    fetchResult = { ok: true, status: 200, json: async () => ({ ok: true, status: 'rejected' }) };
    await handlers.reject();
    check('rejecting calls reject and says nothing was imported', fetched.body.action === 'reject' && /nothing was imported/i.test(msg.textContent));

    const emptyEl = { innerHTML: '', querySelector: () => null };
    host._renderBladeResult(emptyEl, { artifactId: 'a', stats: {}, leads: [], note: 'No qualifying businesses' });
    check('an empty result shows its reason and offers no approval at all', /No qualifying businesses/.test(emptyEl.innerHTML) && !/blade-approve/.test(emptyEl.innerHTML));

    check('attribute-context values get quotes escaped', host._escapeAttr('a"b\'c') === 'a&quot;b&#39;c');
  }

  console.log(failures === 0 ? '\nALL ASSERTIONS PASSED\n' : `\n${failures} FAILED\n`);
  process.exit(failures === 0 ? 0 : 1);
})();
