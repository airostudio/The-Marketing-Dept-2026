/**
 * The UI here is built by assigning template strings to innerHTML — 800-odd
 * sites — and a lot of what goes into those strings was written by somebody
 * other than the person reading the page: a crawled site, a competitor name an
 * LLM returned, a lead record from an enrichment API, a support ticket, a
 * teammate's display name, another account's signup form.
 *
 * ── The two things this suite exists for ─────────────────────────────────
 *
 * 1. The admin console rendered attacker-chosen text unescaped.
 *
 *    web/admin/users.html listed every account's firstname, lastname and email
 *    straight into innerHTML, and put the whole user object through
 *    JSON.stringify into a single-quoted onclick attribute. Those fields are
 *    whatever someone typed at signup. A name of <img src=x onerror=...> — or
 *    just an apostrophe, for the attribute case — ran script in an
 *    administrator's session, and that session can read, re-role and delete
 *    every account through api/admin-users.js. Ordinary user to admin, via a
 *    signup form.
 *
 * 2. Most of the escapers did not escape quotes.
 *
 *    Thirty-one of them were this:
 *
 *        const div = document.createElement('div');
 *        div.textContent = text;
 *        return div.innerHTML;
 *
 *    which escapes & < > and nothing else, because the browser does not escape
 *    quotes when serialising textContent. About twenty call sites were
 *    attribute-position — value="${escapeHtml(name)}" — where one `"` ends the
 *    attribute and the rest of the value is parsed as more attributes on the
 *    tag. Two pages named such a function escAttr().
 *
 *   node tests/xss/run.js
 */
'use strict';

const path = require('path');
const fs = require('fs');

const REPO = path.resolve(__dirname, '..', '..');

let failures = 0;
function check(label, ok) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failures++;
}
function read(rel) { return fs.readFileSync(path.join(REPO, rel), 'utf8'); }

/**
 * Source with comments removed.
 *
 * Every assertion below is about code, and this file's own explanatory
 * comments quote the exact patterns being asserted against — the admin row
 * carries a comment saying what the onclick attribute used to be, and
 * escape-html.js shows the broken escaper it replaced. Without this, a suite
 * that reads the raw text reports the explanation as the defect.
 */
function code(rel) {
  return read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
}

/** Source files that build UI, minus vendored libraries. No npm here — this
 *  repo has no dependencies and these suites keep it that way. */
function uiFiles(dir = 'web', out = []) {
  for (const entry of fs.readdirSync(path.join(REPO, dir), { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) uiFiles(rel, out);
    else if (/\.(html|js)$/.test(entry.name) && !/chart\.umd|supabase\.min/.test(entry.name)) out.push(rel);
  }
  return out;
}

/**
 * The text of a function body, starting from the parameter list.
 *
 * Returns the balanced-brace block for a statement body, or the expression up
 * to its terminating semicolon for a concise arrow. A fixed-size window does
 * not work here: it reaches into whatever function is defined next, which is
 * how an earlier version of this scan reported clean escapers as broken.
 */
function functionBody(src, from) {
  const brace = src.indexOf('{', from);
  const newline = src.indexOf('\n', from);
  const isBlock = brace !== -1 &&
    (newline === -1 || brace < newline || ['', '=>'].includes(src.slice(from, brace).trim()));
  if (isBlock) {
    let depth = 0;
    for (let k = brace; k < src.length && k < brace + 8000; k++) {
      if (src[k] === '{') depth++;
      else if (src[k] === '}' && --depth === 0) return src.slice(brace, k + 1);
    }
    return src.slice(brace, brace + 1200);
  }

  // A concise arrow body: everything up to whatever is declared next.
  //
  // Two more obvious rules both fail here. A fixed-size window reaches into
  // the following function, which reported clean escapers as broken. Stopping
  // at the first ';' cuts the body off inside '&amp;' — every HTML entity ends
  // in a semicolon — and trying to skip string literals to avoid that
  // desynchronises on the `"` inside the regex /[&<>"]/g, which is not a
  // string at all. Ending at the next declaration needs no lexer and cannot
  // truncate the thing being examined.
  const rest = src.slice(from, from + 4000);
  const next = rest.search(/\n\s*(?:function\s|const\s|let\s|var\s|window\.|\/\*)/);
  return next === -1 ? rest : rest.slice(0, next);
}

const ESCAPER_DEF = new RegExp(
  '(?:function\\s+(esc\\w*|escape\\w*)\\s*\\([^)]*\\)\\s*' +
  '|(?:const|let|var)\\s+(esc\\w*|escape\\w*)\\s*=\\s*(?:function\\s*)?\\(?[\\w\\s,]*\\)?\\s*=>\\s*)', 'gi');

/** Every escaper defined anywhere, with its body. */
function allEscapers() {
  const out = [];
  for (const f of uiFiles()) {
    const src = code(f);
    ESCAPER_DEF.lastIndex = 0;
    let m;
    while ((m = ESCAPER_DEF.exec(src)) !== null) {
      const name = m[1] || m[2];
      // Two functions here are named like escapers and are not: escapeCSVField
      // quotes for CSV, and escapeJs escapes for a JavaScript string literal.
      // Neither should produce HTML entities, so neither is judged on them.
      if (/^escapecsv/i.test(name) || /^escapejs$/i.test(name)) continue;
      out.push({ file: f, name, line: src.slice(0, m.index).split('\n').length, body: functionBody(src, m.index + m[0].length) });
    }
  }
  return out;
}

/** Does this body escape double quotes, or hand off to something that does? */
function escapesQuotes(e) {
  if (/&quot;|&#34;/.test(e.body)) return true;
  // An entity table held next to the function rather than inline in it.
  if (/HTML_ENTITIES/.test(e.body)) return true;
  // A one-line delegator: `escAttr = str => escHtml(str)`.
  if (/^\s*\{?\s*(?:return\s+)?(esc\w*|escape\w*)\s*\(/i.test(e.body) &&
      !/replace|textContent/.test(e.body)) return true;
  return false;
}

/* ── 1. The canonical escaper ───────────────────────────────────────────── */
console.log('\n──── one escaper that is right in both positions ────');

const g = {};
new Function('window', read('web/js/escape-html.js'))(g);
const { escapeHtml, escapeJs, safeUrl, escAttr } = g;

check('escapeHtml handles all five characters',
  escapeHtml(`<>&"'`) === '&lt;&gt;&amp;&quot;&#39;');
check('a tag in text position is neutralised',
  !/[<>]/.test(escapeHtml('<img src=x onerror=alert(1)>')));
check('a quote cannot end an attribute',
  !/"/.test(escapeHtml('" onmouseover=alert(1) x="')));
check('an apostrophe cannot end a single-quoted attribute',
  !/'/.test(escapeHtml("O'Brien")));
check('null and undefined render as empty, not as the words',
  escapeHtml(null) === '' && escapeHtml(undefined) === '');
check('escAttr is the same function, not a weaker alias',
  escAttr === escapeHtml);

check('escapeJs escapes the quote that would close a JS string',
  /\\'/.test(escapeJs("'); alert(1); //")));
check('and the < that would close a script block',
  !/</.test(escapeJs('</script>')));

check('safeUrl passes http, https, mailto and tel',
  safeUrl('https://x.test/a') === 'https://x.test/a' &&
  safeUrl('mailto:a@b.test') === 'mailto:a@b.test' &&
  safeUrl('tel:+61400000000') === 'tel:+61400000000');
check('safeUrl blocks javascript:, data: and vbscript:',
  safeUrl('javascript:alert(1)') === '' &&
  safeUrl('data:text/html,x') === '' &&
  safeUrl('VBScript:msgbox') === '');
check('and the whitespace-inside-the-scheme trick browsers ignore',
  safeUrl('java\tscript:alert(1)') === '' && safeUrl('java\nscript:alert(1)') === '');
check('relative URLs are left alone, including ones containing a colon',
  safeUrl('/dashboard.html') === '/dashboard.html' &&
  safeUrl('#top') === '#top' &&
  safeUrl('docs/api:v2') === 'docs/api:v2');

/* ── 2. No escaper anywhere leaves quotes alone ─────────────────────────── */
console.log('\n──── every escaper in the app escapes quotes ────');

const escapers = allEscapers();
const weak = escapers.filter(e => !escapesQuotes(e));
check(`all ${escapers.length} escaper definitions escape double quotes`, weak.length === 0);
weak.forEach(e => console.log(`      ${e.file}:${e.line}  ${e.name}()`));

// The specific implementation that caused this: correct between tags, wrong
// inside an attribute, and indistinguishable from a correct one at the call
// site.
const textContentTrick = escapers.filter(e =>
  /textContent/.test(e.body) && /innerHTML/.test(e.body) && !/&quot;/.test(e.body));
check('no escaper is still the textContent/innerHTML trick', textContentTrick.length === 0);
textContentTrick.forEach(e => console.log(`      ${e.file}:${e.line}  ${e.name}()`));

/* ── 3. The admin console ───────────────────────────────────────────────── */
console.log('\n──── the admin user list ────');

const admin = code('web/admin/users.html');
const row = admin.slice(admin.indexOf('function renderUserRow'),
                        admin.indexOf('function openCreateUserModal'));

check('the page uses the shared escaper, with a fallback if it fails to load',
  /const escapeHtml = window\.escapeHtml \|\|/.test(admin));
check('and loads it before the page script runs',
  read('web/admin/users.html').indexOf('/js/escape-html.js') <
  read('web/admin/users.html').indexOf('function renderUserRow'));
check('it escapes quotes', /&quot;/.test(admin) && /&#39;/.test(admin));

for (const field of ['user.email', 'user.firstname', 'user.lastname']) {
  const bare = new RegExp('\\$\\{\\s*' + field.replace('.', '\\.') + '\\s*(\\|\\||\\})');
  check(`${field} is not interpolated bare`, !bare.test(row));
}
const unescaped = (row.match(/\$\{(?!escapeHtml\()[^}]*\}/g) || []);
check('every single interpolation in the row goes through the escaper',
  unescaped.length === 0);
unescaped.forEach(u => console.log(`      ${u.slice(0, 60)}`));

// The action buttons put a user record inside a single-quoted attribute:
// onclick='editUser(${JSON.stringify(user)})'. An apostrophe in any field —
// O'Brien, or a deliberate one — ended the attribute.
check('no user object is serialised into an attribute',
  !/JSON\.stringify\(user\)/.test(row));
check('the row has no inline onclick at all',
  !/onclick=/.test(row));
check('the buttons get listeners that close over the record instead',
  /addEventListener\('click'/.test(row) &&
  /editUser\(user\)/.test(row) &&
  /deleteUser\(user\.id/.test(row));

/* ── 4. The escaper is available to new code ────────────────────────────── */
console.log('\n──── a shared implementation for what comes next ────');

const shared = read('web/js/escape-html.js');
check('escape-html.js exposes the three it needs to',
  /window\.escapeHtml\s*=/.test(shared) &&
  /window\.escapeJs\s*=/.test(shared) &&
  /window\.safeUrl\s*=/.test(shared));
check('and says plainly what it does not cover',
  /NOT sufficient/.test(shared) && /javascript:/.test(shared));

console.log(failures === 0 ? '\nALL ASSERTIONS PASSED\n' : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
