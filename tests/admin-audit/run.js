/**
 * The administrative audit trail.
 *
 * admin_activity_log had existed in the schema since the admin console was
 * built — three indexes, an RLS policy, a comment naming the actions it would
 * hold — and nothing had ever written a row to it. An administrator could
 * change a plan, promote an account to super_admin, or delete a customer, and
 * there was no record that it happened, who did it, or when. On a platform
 * where an admin can read across every tenant, that is the first thing a
 * customer's security review asks for.
 *
 * What this pins, and why each one is load-bearing:
 *
 *   The row is written AFTER the action succeeded. An entry saying an account
 *   was deleted, written beside a delete that then failed, is worse than no
 *   entry at all: it is a confident record of something that did not happen.
 *
 *   A delete captures the target's email BEFORE the account goes. Afterwards
 *   the id is a foreign key to a row that no longer exists, and "some deleted
 *   user was deleted" answers no question.
 *
 *   admin_id is ON DELETE SET NULL, not CASCADE. Removing an administrator
 *   must not remove the history of what that administrator did — which is
 *   precisely the history anyone would come looking for.
 *
 *   The table has no INSERT, UPDATE or DELETE policy. There used to be an
 *   INSERT policy letting any admin write rows through the anon key, which
 *   let an administrator manufacture entries by hand. Writes come from the
 *   server on the service-role key, which bypasses RLS, so removing it costs
 *   nothing and closes the forgery route.
 *
 *   Recording never throws. A failed audit write must not fail the action the
 *   administrator asked for — but it must not pass silently either, so it is
 *   reported through the same failure pipeline as everything else.
 *
 *   node tests/admin-audit/run.js
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
    .split('\n').filter(l => !/^\s*(\/\/|--)/.test(l)).join('\n');
}

console.log('\n──── 1. the schema can hold evidence ────');

const sql = code('database/admin-setup.sql');
check('admin_id survives the administrator being deleted (SET NULL, not CASCADE)',
  /admin_id UUID REFERENCES auth\.users\(id\) ON DELETE SET NULL/.test(sql) &&
  !/admin_id UUID NOT NULL REFERENCES auth\.users\(id\) ON DELETE CASCADE/.test(sql));
check('the emails are stored alongside the ids',
  /admin_email\s+TEXT/.test(sql) && /target_email\s+TEXT/.test(sql));
check('existing installs are migrated, not just new ones',
  /ADD COLUMN IF NOT EXISTS admin_email/.test(sql) &&
  /admin_activity_log_admin_id_fkey/.test(sql));
check('no client can insert, amend or erase an entry',
  !/CREATE POLICY[^;]*ON admin_activity_log\s*\n?\s*FOR (INSERT|UPDATE|DELETE)/.test(sql));
check('admins can still read it',
  /CREATE POLICY "Admins can view activity log" ON admin_activity_log/.test(sql));

console.log('\n──── 2. the source SQL is safe to run twice ────');

/* The error a customer actually hit: running a source file a second time
   died with 42710 "policy already exists", leaving the database half
   migrated. Every CREATE POLICY/TRIGGER needs a DROP ... IF EXISTS. */
const SQL_FILES = fs.readdirSync(REPO).filter(f => /^supabase-.*\.sql$/.test(f) && !f.includes('install-all'))
  .concat(fs.readdirSync(path.join(REPO, 'database')).filter(f => f.endsWith('.sql')).map(f => 'database/' + f));
let unguarded = 0;
for (const rel of SQL_FILES) {
  const lines = read(rel).split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*CREATE (POLICY|TRIGGER)\s/.test(lines[i]) &&
        !/IF EXISTS/.test(lines.slice(Math.max(0, i - 3), i).join('\n'))) {
      if (unguarded < 5) console.log(`        ${rel}:${i + 1}`);
      unguarded++;
    }
  }
}
check(`every CREATE POLICY/TRIGGER across ${SQL_FILES.length} source files is guarded (${unguarded} unguarded)`,
  unguarded === 0);

console.log('\n──── 3. the installer is generated, not hand-kept ────');

check('the generator is in the repository', fs.existsSync(path.join(REPO, 'scripts/build-install-all.py')));
const installer = read('supabase-install-all.sql');
check('the installer says it is generated and how to rebuild it',
  /GENERATED FILE/.test(installer) && /build-install-all\.py/.test(installer));
check('the installer carries the audited table', /CREATE TABLE IF NOT EXISTS admin_activity_log/.test(installer));
check('and the new columns reached it', /admin_email/.test(installer));

console.log('\n──── 4. the write happens, in the right order ────');

const users = code('api/admin-users.js');
check('a created account is recorded', /recordAdminAction\(\{[\s\S]{0,200}ACTIONS\.USER_CREATED/.test(users));
check('granting admin at creation is recorded separately', /ACTIONS\.ROLE_GRANTED/.test(users));
check('a deleted account is recorded', /ACTIONS\.USER_DELETED/.test(users));
/* Order matters: createUser/deleteUser must come before their record. */
const createAt = users.indexOf('await createUser(');
const createRec = users.indexOf('ACTIONS.USER_CREATED');
check('the creation is recorded after the account exists', createAt > -1 && createRec > createAt);
const emailRead = users.indexOf('select=email&limit=1');
const deleteAt = users.indexOf('await deleteUser(');
check('the target email is read before the account is deleted',
  emailRead > -1 && deleteAt > -1 && emailRead < deleteAt);
check('the owner-email grant is recorded too', /ACTIONS\.OWNER_CLAIMED/.test(code('api/_lib/require-user.js')));

console.log('\n──── 5. recording never breaks the thing being recorded ────');

const lib = code('api/_lib/audit-log.js');
check('a failed write is caught, not thrown', /catch \(err\)/.test(lib) && /return false;/.test(lib));
check('and it is reported rather than swallowed', /reportFailureAsync\(\{/.test(lib));
check('the client IP takes the last forwarded hop, not the first',
  /hops\[hops\.length - 1\]/.test(lib));

console.log('\n──── 6. the console can read it, and only read it ────');

const api = code('api/admin-activity.js');
check('the endpoint is admin-gated', /requireAdmin\(req, res\)/.test(api));
check('filters are validated before they reach a PostgREST query',
  /isUuid\(String\(q\.admin\)\)/.test(api) && /\^\[a-z0-9_\]\{1,120\}\$/.test(api));
check('it says when the answer is truncated', /truncated:/.test(api));
check('there is no endpoint that deletes an entry',
  !/DELETE/.test(api.replace(/Allow-Methods[^\n]*/g, '')));

const page = read('web/admin/activity.html');
check('the page exists and is admin-gated',
  /super_admin/.test(page) && /admin-activity/.test(page));
check('every admin page links to it',
  fs.readdirSync(path.join(REPO, 'web/admin'))
    .filter(f => f.endsWith('.html'))
    .every(f => read('web/admin/' + f).includes('admin/activity.html')));

console.log(failures === 0 ? '\nALL ASSERTIONS PASSED\n' : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
