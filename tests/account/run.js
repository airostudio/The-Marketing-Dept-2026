/**
 * Account layer checks: the password-reset landing page that never existed,
 * the account page, and the user badge that used to lie about the plan.
 *
 *   PLAYWRIGHT_PATH=/opt/node22/lib/node_modules/playwright node tests/account/run.js
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

// Scenario is swapped between page loads.
let scenario = {};

function stubScript() {
  return `<script>
    window.__calls = { updatePassword: [], resetPassword: [], updateProfile: [] };
    const S = ${JSON.stringify(scenario)};
    window.Supabase = {
      ready: async () => {},
      isConfigured: () => S.configured !== false,
      getClient: () => S.configured === false ? null : ({
        auth: { getSession: async () => ({ data: { session: S.session || null } }) },
      }),
      Auth: {
        updatePassword: async (p) => {
          window.__calls.updatePassword.push(p);
          if (S.updateFails) throw new Error('New password should be different');
          return {};
        },
        resetPassword: async (e) => { window.__calls.resetPassword.push(e); return {}; },
      },
      DB: {
        getProfile: async () => S.profile || null,
        updateProfile: async (id, patch) => { window.__calls.updateProfile.push(patch); return patch; },
      },
    };
    window.Auth = { getUser: async () => S.user || null };
  </script>`;
}

const server = http.createServer((req, res) => {
  const u = req.url.split('?')[0].split('#')[0];
  const page = { '/reset-password.html': 'web/reset-password.html',
                 '/account.html': 'web/account.html' }[u];
  if (page) {
    let html = fs.readFileSync(path.join(REPO, page), 'utf8');
    // Stubs must land AFTER the real modules or they get overwritten.
    html = html.replace('<script src="/js/auth.js"></script>', stubScript());
    if (!html.includes('window.__calls')) {
      html = html.replace('<script src="/js/supabase-client.js"></script>', stubScript());
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(html);
  }
  const m = u.match(/^\/js\/([\w.-]+)$/);
  if (m) {
    const f = path.join(REPO, 'web/js', m[1]);
    if (fs.existsSync(f)) {
      res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8' });
      return res.end(fs.readFileSync(f, 'utf8'));
    }
    res.writeHead(200, { 'content-type': 'application/javascript' }); return res.end('');
  }
  res.writeHead(404); res.end('not found');
});

server.listen(0, async () => {
  const port = server.address().port;
  const base = `http://localhost:${port}`;
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));

  const view = () => page.evaluate(() => ({
    set: !document.getElementById('set-view').classList.contains('hidden'),
    request: !document.getElementById('request-view').classList.contains('hidden'),
    done: !document.getElementById('done-view').classList.contains('hidden'),
    msg: document.getElementById('msg').textContent.trim(),
  }));

  /* ── reset-password.html ─────────────────────────────────────────────── */
  console.log('──── reset-password.html (the page that did not exist) ────');

  // The page is reachable at the exact path Auth.resetPassword() redirects to.
  // Scoped to resetPassword() specifically — there is a second, unrelated
  // redirectTo for OAuth that points at /dashboard.html.
  const clientSrc = fs.readFileSync(path.join(REPO, 'web/js/supabase-client.js'), 'utf8');
  const resetFn = clientSrc.slice(clientSrc.indexOf('async resetPassword'));
  const redirectTarget = resetFn.match(/redirectTo:\s*window\.location\.origin\s*\+\s*'([^']+)'/);
  check('exists at the path resetPassword() redirects to',
    redirectTarget && redirectTarget[1] === '/reset-password.html' &&
    fs.existsSync(path.join(REPO, 'web/reset-password.html')));

  // No token → offer to send a link, rather than a dead end.
  scenario = { session: null, configured: true };
  await page.goto(`${base}/reset-password.html`);
  await page.waitForTimeout(400);
  let v = await view();
  check('with no token, offers to send a reset link', v.request && !v.set);

  // A valid recovery link → password form.
  scenario = { session: { user: { id: 'u1' } }, configured: true };
  await page.goto(`${base}/reset-password.html?n=1#access_token=abc&type=recovery`);
  await page.waitForTimeout(700);
  v = await view();
  check('a valid recovery link shows the new-password form', v.set);
  check('the token is cleared out of the address bar',
    !(await page.evaluate(() => location.hash)));

  // Validation.
  await page.fill('#pw1', 'short'); await page.fill('#pw2', 'short');
  await page.click('#btn-set'); await page.waitForTimeout(200);
  check('rejects a password under 8 characters', /at least 8/i.test((await view()).msg));

  await page.fill('#pw1', 'a-good-passphrase'); await page.fill('#pw2', 'different-one');
  await page.click('#btn-set'); await page.waitForTimeout(200);
  check('rejects a mismatched confirmation', /do not match/i.test((await view()).msg));

  await page.fill('#pw1', 'a-good-passphrase'); await page.fill('#pw2', 'a-good-passphrase');
  await page.click('#btn-set'); await page.waitForTimeout(400);
  const calls = await page.evaluate(() => window.__calls);
  check('a valid password calls updatePassword', calls.updatePassword.includes('a-good-passphrase'));
  check('and confirms success', (await view()).done);

  // Expired link → says so, does not show a form that will fail later.
  scenario = { session: null, configured: true };
  await page.goto(`${base}/reset-password.html?n=2#error_description=Email+link+is+invalid+or+has+expired`);
  await page.waitForTimeout(400);
  v = await view();
  check('an expired link says so and offers a new one',
    v.request && /no longer valid|expired/i.test(v.msg));

  // Requesting a link must not reveal whether the address is registered.
  await page.fill('#email', 'someone@example.com');
  await page.click('#btn-request'); await page.waitForTimeout(300);
  const reqMsg = await page.evaluate(() => document.getElementById('msg').textContent);
  check('sends the reset request', (await page.evaluate(() => window.__calls.resetPassword)).length === 1);
  check('does not disclose whether that email has an account', /if that email/i.test(reqMsg));

  /* ── account.html ────────────────────────────────────────────────────── */
  console.log('\n──── account.html ────');

  scenario = {
    user: { id: 'u1', email: 'sam@example.com' },
    profile: { firstname: 'Sam', lastname: 'Rivera', email: 'sam@example.com',
               company: 'Rivera Co', plan: 'growth', subscription_status: 'active',
               current_period_end: '2026-11-01T00:00:00Z' },
  };
  await page.goto(`${base}/account.html`);
  await page.waitForTimeout(600);
  const acc = await page.evaluate(() => ({
    visible: document.getElementById('wrap').style.display === 'block',
    plan: document.getElementById('plan-name').textContent,
    sub: document.getElementById('plan-sub').textContent,
    first: document.getElementById('firstname').value,
    emailDisabled: document.getElementById('email').disabled,
  }));
  console.log('  plan shown:', acc.plan.replace(/\s+/g, ' '), '|', acc.sub);
  check('shows the account', acc.visible);
  check('shows the REAL plan, not a fixed label', /Growth/.test(acc.plan) && !/Pro Plan/.test(acc.plan));
  check('shows the real subscription status', /Active/.test(acc.plan));
  check('shows the renewal date', /Renews/.test(acc.sub));
  check('prefills the profile', acc.first === 'Sam');
  check('email is not self-service editable', acc.emailDisabled === true);

  await page.fill('#company', 'Rivera Group');
  await page.click('#btn-save'); await page.waitForTimeout(300);
  const saved = await page.evaluate(() => window.__calls.updateProfile);
  check('saves profile changes', saved.length === 1 && saved[0].company === 'Rivera Group');
  check('never writes plan or role from the client',
    saved.every(p => !('plan' in p) && !('role' in p) && !('subscription_status' in p)));

  // A free account must not be told it is on a paid plan.
  scenario = { user: { id: 'u2', email: 'free@example.com' },
               profile: { email: 'free@example.com', plan: 'free' } };
  await page.goto(`${base}/account.html`);
  await page.waitForTimeout(600);
  const freeAcc = await page.evaluate(() => ({
    plan: document.getElementById('plan-name').textContent,
    sub: document.getElementById('plan-sub').textContent,
  }));
  check('a free account is shown as Free, not Pro',
    /Free/.test(freeAcc.plan) && !/Pro|Growth/.test(freeAcc.plan));
  check('and is told it has no paid subscription', /No paid subscription/i.test(freeAcc.sub));

  // Signed out.
  scenario = { user: null };
  await page.goto(`${base}/account.html`);
  await page.waitForTimeout(500);
  check('signed out gets a sign-in prompt, not a blank page',
    /signed in/i.test(await page.evaluate(() => document.getElementById('gate').textContent)));

  check('no JS errors', errs.length === 0);
  if (errs.length) console.log('  errors:', errs.slice(0, 4));

  console.log('\n' + (fail.length === 0
    ? 'ALL ASSERTIONS PASSED'
    : `${fail.length} FAILED: ${fail.join(' | ')}`));

  await browser.close();
  server.close();
  process.exit(fail.length === 0 ? 0 : 1);
});
