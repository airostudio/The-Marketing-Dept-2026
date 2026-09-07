/**
 * Compliance Guard, Enterprise Compliance and Compliance Command.
 *
 * The two agent pages — compliance-agent.html (Compliance Guard) and
 * compliance-automation.html (Enterprise Compliance) — are clean. They are AI
 * review tools over content the customer pastes, they load the services they
 * call, and they assert nothing about the customer's posture. Untouched.
 *
 * Compliance Command held all the findings, and they are the most serious kind
 * this product can produce, because the output of a compliance tool is what
 * someone carries into a security questionnaire or an auditor conversation.
 *
 *   1. Twenty-seven of the forty-eight evidence items were pre-marked
 *      "collected" on a customer's very first visit. That drove an overall
 *      readiness score of 56%, per-framework "On Track" badges, and a
 *      collected status on each row. Nobody had gathered an Access Control
 *      Policy, an MFA enforcement screenshot or security training records —
 *      the tool simply said they had.
 *
 *   2. The collection date for each of those was
 *      `'2026-05-' + Math.floor(Math.random()*28+1)` — a different fabricated
 *      date on every single re-render, for evidence that did not exist.
 *
 *   3. The risk register was seeded with three invented risks, complete with
 *      owners (Engineering, Security, HR), severities and dates, so a new
 *      account's compliance history began with three findings nobody had made.
 *
 *   4. Both AI panels told the customer to "Connect your API key in Settings"
 *      — a key that is held server-side and that they cannot add.
 *
 *   node tests/compliance/run.js
 */
const path = require('path');
const fs = require('fs');
const http = require('http');
const REPO = path.resolve(__dirname, '../..');

const fail = [];
const check = (name, cond) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name);
  if (!cond) fail.push(name);
};
const read = f => fs.readFileSync(path.join(REPO, f), 'utf8');
const code = f => read(f).split('\n')
  .filter(l => !/^\s*(\/\/|\*|\/\*|<!--)/.test(l)).join('\n');

const COMMAND = 'web/intelligence/compliance-command.html';
const GUARD   = 'web/agents/compliance-agent.html';
const ENT     = 'web/agents/compliance-automation.html';

(async () => {
  const cmd = code(COMMAND);

  /* ── 1. Nothing is collected until someone collects it ────────────────── */
  console.log('──── a compliance posture nobody established ────');

  check('no evidence item is pre-marked collected',
    !/defaultStatus: 'collected'/.test(cmd));
  check('the seeding block that did it is gone',
    !/evidenceState\[item\.id\] = item\.defaultStatus === 'collected'/.test(cmd));
  check('defaultStatus is gone entirely, so nothing can reintroduce it',
    !/defaultStatus:/.test(cmd));
  check('what remains is a priority hint about the control, not a claim about the customer',
    /priority: 'high'/.test(cmd) && /priority: 'standard'/.test(cmd));

  // Every item must be scored, or the denominator lies.
  const items = [...cmd.matchAll(/\{ id: '([^']+)', fw: '([^']+)'/g)];
  check('all 48 evidence items are still present', items.length === 48);
  const priorities = (cmd.match(/priority: '(high|standard)'/g) || []).length;
  check('and every one carries a priority', priorities === 48);

  // The declared per-framework totals drive fwScore's denominator.
  const declared = {};
  for (const m of cmd.matchAll(/(\w+):\s*\{ label: '[^']+',\s*count:\s*(\d+)/g)) declared[m[1]] = Number(m[2]);
  const actual = {};
  items.forEach(([, , fw]) => { actual[fw] = (actual[fw] || 0) + 1; });
  check('each framework\'s declared count matches its real item count',
    Object.keys(declared).every(k => declared[k] === (actual[k] || 0)));

  /* ── 2. Dates are recorded, not invented ──────────────────────────────── */
  console.log('\n──── the audit trail is real ────');

  check('the Math.random date generator is gone',
    !/'2026-05-' \+ String\(Math\.floor\(Math\.random\(\)/.test(cmd));
  check('nothing on this page derives a value from Math.random',
    !/Math\.random/.test(cmd));
  check('a real timestamp is recorded when the box is ticked',
    /evidenceDates\[id\] = new Date\(\)\.toISOString\(\)/.test(cmd));
  check('and cleared when it is un-ticked, so a date never outlives its claim',
    /delete evidenceDates\[id\]/.test(cmd));
  check('the recorded date is persisted, not just held in memory',
    /saveEvidenceDates/.test(cmd));

  /* ── 3. The risk register starts empty ────────────────────────────────── */
  console.log('\n──── the risk register is the customer\'s own ────');

  check('the three invented risks are gone',
    !/Single admin account without MFA/.test(cmd) &&
    !/Employee offboarding access revocation delay/.test(cmd));
  check('DEFAULT_RISKS is empty', /const DEFAULT_RISKS = \[\];/.test(cmd));
  check('nothing is seeded into it on first visit',
    !/if \(!localStorage\.getItem\(LS_RISKS\)\) saveRisks/.test(cmd));
  check('an empty register says so', /No risks recorded yet/.test(cmd));

  /* ── 4. No false instruction about an API key ─────────────────────────── */
  console.log('\n──── the customer is not sent after a setting that does not exist ────');

  [['command', COMMAND], ['guard', GUARD], ['enterprise', ENT]].forEach(([label, f]) => {
    check(`${label}: no "connect your API key in Settings"`,
      !/Connect your API key in Settings/i.test(code(f)));
  });
  check('command: the message says what actually went wrong',
    /The AI service failed to load/.test(cmd));

  /* ── 5. The two agent pages remain honest ─────────────────────────────── */
  console.log('\n──── Compliance Guard and Enterprise Compliance ────');

  [['guard', GUARD], ['enterprise', ENT]].forEach(([label, f]) => {
    const src = code(f);
    check(`${label}: reviews content the customer supplies, not invented findings`,
      /ClaudeService/.test(src) && !/Math\.random/.test(src));
    check(`${label}: loads the service it calls`, /claude-service\.js/.test(read(f)));
    check(`${label}: carries the session`, /send-auth\.js/.test(read(f)));
    check(`${label}: asserts no compliance score of its own`,
      !/defaultStatus|DEFAULT_RISKS|evidenceState/.test(src));
  });

  /* ── 6. Links resolve ─────────────────────────────────────────────────── */
  console.log('\n──── no dead ends ────');

  const broken = [];
  [COMMAND, GUARD, ENT].forEach(f => {
    const dir = path.dirname(path.join(REPO, f));
    for (const m of read(f).matchAll(/href="([^"#][^"]*\.html[^"]*)"/g)) {
      const t = m[1].split('?')[0];
      const abs = t.startsWith('/') ? path.join(REPO, 'web', t) : path.resolve(dir, t);
      if (!fs.existsSync(abs)) broken.push(f + ' -> ' + m[1]);
    }
  });
  check('every link resolves', broken.length === 0);
  if (broken.length) console.log('    ', [...new Set(broken)]);

  const handlers = [];
  [COMMAND, GUARD, ENT].forEach(f => {
    const src = read(f);
    for (const m of new Set([...src.matchAll(/onclick="([a-zA-Z_$][\w$]*)\s*\(/g)].map(x => x[1]))) {
      if (m === 'this') continue;
      if (!new RegExp('function ' + m + '\\b|' + m + '\\s*=\\s*function|window\\.' + m + '\\s*=').test(src)) {
        handlers.push(path.basename(f) + ': ' + m);
      }
    }
  });
  check('every onclick handler is defined', handlers.length === 0);
  if (handlers.length) console.log('    ', handlers);

  /* ── 8. The dashboard asserts nothing it did not observe ─────────────── */
  console.log('\n──── no fabricated live monitoring ────');

  check('the static "Continuous Monitoring" rows are gone',
    !/<span class="mon-badge pass">PASS<\/span>/.test(cmd));
  check('no check claims to have run minutes or hours ago',
    !/Automated check &middot; 2 mins ago/.test(cmd) &&
    !/100% of accounts &middot; 12 hours ago/.test(cmd));
  check('and the panel says plainly that nothing monitors these controls',
    /Continuous monitoring is not connected/.test(cmd));
  check('it also says what would be needed',
    /reading from your actual/.test(cmd));

  check('the hardcoded "Days to Audit: 87" is gone',
    !/>87<\/div>/.test(cmd) && !/Target: Q4 2026/.test(cmd));
  check('the audit countdown is whatever date the customer sets',
    /LS_AUDIT_DATE/.test(cmd) && /function updateAuditCountdown\(/.test(cmd));
  check('the register-size sub-label is derived, not static',
    /sub\.textContent = risks\.length \+ ' total in register'/.test(cmd));

  /* ── 7. In a browser ──────────────────────────────────────────────────── */
  console.log('\n──── a brand-new account, in a real browser ────');

  const b = await inBrowser();
  try {
    check('the page loads with no JavaScript error', b.errors.length === 0);
    if (b.errors.length) console.log('    ', b.errors);

    check('a fresh account shows nothing collected',
      b.fresh.collected === 0 && b.fresh.cards === 48);
    check('and no collection dates', b.fresh.datesShown === 0);
    check('and writes nothing to storage before the customer acts',
      b.fresh.stored === null);
    // Every percentage a fresh account can see must be 0 — there used to be an
    // 87% training-completion and a 100% MFA-coverage claim sitting in static
    // markup, which is exactly what someone screenshots for a questionnaire.
    check('no percentage on a fresh dashboard is anything but 0%',
      b.dashPercents.length > 0 && b.dashPercents.every(v => v === '0%'));
    check('and the audit countdown is unset rather than invented',
      b.auditDays === '—' && /Click to set/.test(b.auditSub));
    check('the monitoring panel states it is not connected',
      /Continuous monitoring is not connected/.test(b.monitoring));
    check('the risk register is empty', /No risks recorded yet/.test(b.risks));
    // A mis-balanced <div> nests one tab panel inside another, which leaves
    // the inner one permanently invisible — the page still renders, so the
    // break is silent until someone clicks the tab. My own edit to the
    // monitoring panel caused exactly this, and this check caught it.
    check('no tab panel is nested inside another', b.badNesting.length === 0);
    if (b.badNesting.length) console.log('    ', b.badNesting);

    check('ticking an item records today\'s date immediately',
      /^\d{4}-\d{2}-\d{2}$/.test(b.afterTick.date) && b.afterTick.status === 'Collected');
    check('and that date is stable across a re-render, because it is real',
      b.rerenderDate === b.afterTick.date);
    check('un-ticking removes the date with the claim',
      b.afterUntick.date === '—' && b.afterUntick.status === 'Not collected');
    check('a priority gap keeps its label through a tick and un-tick',
      b.priorityLabel === 'Priority gap');
  } finally {
    await b.close();
  }

  console.log('\n' + (fail.length === 0
    ? 'ALL ASSERTIONS PASSED'
    : `${fail.length} FAILED: ${fail.join(' | ')}`));
  process.exit(fail.length === 0 ? 0 : 1);
})();

/* ── helpers ─────────────────────────────────────────────────────────────── */

async function inBrowser() {
  const { chromium } = require('playwright');
  const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' };
  const ROOT = path.join(REPO, 'web');
  const server = http.createServer((req, res) => {
    const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
      res.writeHead(404); return res.end('nf');
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'text/plain' });
    res.end(fs.readFileSync(f));
  });
  await new Promise(r => server.listen(0, r));
  const br = await chromium.launch();
  const p = await br.newPage();
  const errors = [];
  p.on('pageerror', e => errors.push(e.message));

  await p.goto(`http://127.0.0.1:${server.address().port}/intelligence/compliance-command.html`,
    { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(1100);
  const dashPercents = await p.evaluate(() => document.body.innerText.match(/\d+%/g) || []);
  const auditDays = await p.evaluate(() =>
    (document.getElementById('kpi-audit-days') || {}).textContent.trim());
  const auditSub = await p.evaluate(() =>
    (document.getElementById('kpi-audit-sub') || {}).textContent.trim());
  const monitoring = await p.evaluate(() =>
    (document.querySelector('.monitor-list') || {}).textContent || '');
  const badNesting = await p.evaluate(() => {
    const ids = ['panel-dashboard', 'panel-evidence', 'panel-risks', 'panel-ai-plan'];
    const bad = [];
    ids.forEach(a => ids.forEach(c => {
      if (a === c) return;
      const A = document.getElementById(a), C = document.getElementById(c);
      if (A && C && A.contains(C)) bad.push(c + ' is inside ' + a);
    }));
    return bad;
  });

  await p.click('#tab-evidence');
  await p.waitForTimeout(400);
  const fresh = await p.evaluate(() => ({
    cards: document.querySelectorAll('.ev-card').length,
    collected: document.querySelectorAll('.ev-status.collected').length,
    datesShown: [...document.querySelectorAll('.ev-date')].filter(e => e.textContent.trim() !== '—').length,
    stored: localStorage.getItem('tmd_compliance_evidence'),
  }));

  await p.click('.ev-card .ev-checkbox');
  await p.waitForTimeout(250);
  const afterTick = await p.evaluate(() => ({
    date: document.querySelector('.ev-date').textContent.trim(),
    status: document.querySelector('.ev-status').textContent.trim(),
  }));
  await p.evaluate(() => renderEvidence());
  await p.waitForTimeout(150);
  const rerenderDate = await p.evaluate(() => document.querySelector('.ev-date').textContent.trim());

  await p.click('.ev-card .ev-checkbox');
  await p.waitForTimeout(250);
  const afterUntick = await p.evaluate(() => ({
    date: document.querySelector('.ev-date').textContent.trim(),
    status: document.querySelector('.ev-status').textContent.trim(),
  }));

  const priorityLabel = await p.evaluate(() => {
    const card = [...document.querySelectorAll('.ev-card')]
      .find(c => c.querySelector('.ev-status').textContent.includes('Priority gap'));
    if (!card) return null;
    const id = card.id.replace('evcard-', '');
    toggleEvidence(id, true);
    toggleEvidence(id, false);
    return document.getElementById('evstatus-' + id).textContent.trim();
  });

  await p.click('#tab-risks');
  await p.waitForTimeout(300);
  const risks = await p.evaluate(() => document.getElementById('riskTableBody').textContent);

  return {
    errors, dashPercents, auditDays, auditSub, monitoring, badNesting, fresh, afterTick, rerenderDate, afterUntick, priorityLabel, risks,
    close: async () => { await br.close(); server.close(); },
  };
}
