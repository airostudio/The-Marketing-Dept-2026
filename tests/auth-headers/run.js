/**
 * A page that calls an authenticated endpoint must be able to build the header.
 *
 * The symptom was {"error":"Sign in to use this.","code":"no_token"} returned
 * to a customer who was signed in.
 *
 * sendAuthHeaders() reads the session through window.Supabase and — correctly —
 * returns without the Authorization header rather than throwing when it cannot
 * find one, because refusing an unauthenticated call is the server's job. That
 * is the right behaviour and it is also what made this silent: five pages
 * loaded send-auth.js but never loaded supabase-client.js or the Supabase SDK,
 * so window.Supabase did not exist, the catch swallowed it, and every call went
 * out bare. Express Site Check, the Pulse scanner, the deck image search, the
 * provider probe and diagnostics all returned no_token no matter who was
 * signed in.
 *
 * Same shape as two earlier bugs in this codebase — calling window.reportFailure
 * on a page that never loaded failure-reporter.js, and calling window.safeUrl
 * without escape-html.js. A helper that fails soft is only as good as the
 * check that it is present, so:
 *
 *   Any page that calls a helper must load the script defining it, and
 *   anything that script itself depends on, in an order where the dependency
 *   is already there.
 *
 *   node tests/auth-headers/run.js
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

function pages(dir, out = []) {
  for (const e of fs.readdirSync(path.join(REPO, dir), { withFileTypes: true })) {
    if (e.isDirectory()) { if (e.name !== 'assets') pages(path.join(dir, e.name), out); }
    else if (e.name.endsWith('.html')) out.push(path.join(dir, e.name));
  }
  return out;
}
const PAGES = pages('web');
const read = rel => fs.readFileSync(path.join(REPO, rel), 'utf8');

console.log('\n──── every caller of a global loads what defines it ────');

/* helper → the script that defines it, and what that script needs first. */
const HELPERS = [
  { call: 'sendAuthHeaders',  script: 'send-auth.js',
    needs: ['supabase.min.js', 'supabase-client.js'] },
  { call: 'reportFailure',    script: 'failure-reporter.js', needs: ['send-auth.js'] },
  { call: 'safeUrl',          script: 'escape-html.js',      needs: [] },
];

for (const h of HELPERS) {
  const broken = [];
  for (const p of PAGES) {
    const s = read(p);
    // Defining the helper is not calling it.
    if (!s.includes('window.' + h.call) && !s.includes(h.call + '(')) continue;
    if (s.includes(h.script.replace('.js', '')) === false && !s.includes(h.call + '(')) continue;
    if (!new RegExp('\\b' + h.call + '\\s*\\(').test(s)) continue;
    const missing = [h.script, ...h.needs].filter(dep => !s.includes(dep));
    if (missing.length) broken.push(`${p} (missing ${missing.join(', ')})`);
  }
  check(`${h.call}() — every caller loads ${[h.script, ...h.needs].join(' + ')}`, broken.length === 0);
  broken.slice(0, 8).forEach(b => console.log('        ' + b));
}

console.log('\n──── and loads them in an order where the dependency exists ────');

/* supabase-client.js calls loadConfig() at script-evaluation time and reads
   window.APP_CONFIG. Loaded before config.js it finds nothing and falls back
   to empty localStorage, so the client can come up unconfigured. */
const ORDER = ['supabase.min.js', 'config.js', 'supabase-client.js', 'send-auth.js'];
const misordered = [];
for (const p of PAGES) {
  const s = read(p);
  if (!/\bsendAuthHeaders\s*\(/.test(s)) continue;
  const at = ORDER.map(f => {
    const m = s.match(new RegExp('src="[^"]*' + f.replace('.', '\\.') + '"'));
    return m ? s.indexOf(m[0]) : -1;
  });
  if (at.some(i => i === -1)) continue;   // reported by the previous section
  for (let i = 1; i < at.length; i++) {
    if (at[i] < at[i - 1]) { misordered.push(`${p} (${ORDER[i]} before ${ORDER[i - 1]})`); break; }
  }
}
check('sdk → config → client → send-auth on every page that sends auth', misordered.length === 0);
misordered.slice(0, 8).forEach(m => console.log('        ' + m));

console.log('\n──── the helper still fails soft rather than throwing ────');

const sendAuth = read('web/js/send-auth.js');
check('it returns headers rather than throwing when there is no session',
  /catch \(e\)/.test(sendAuth) && /return headers;/.test(sendAuth));
check('and the Authorization header is only added when a token exists',
  /if \(token\) headers\.Authorization/.test(sendAuth));

console.log(failures === 0 ? '\nALL ASSERTIONS PASSED\n' : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
