/**
 * The owner account, designated by OWNER_EMAIL.
 *
 * Bootstrapping the first administrator used to mean opening the Supabase SQL
 * editor and running an UPDATE by hand. OWNER_EMAIL replaces that: name the
 * address, sign in with it, hold super_admin.
 *
 * Granting an administrator role from an environment variable is only safe if
 * it is exact about who it grants to, so this pins the three refusals rather
 * than just the happy path:
 *
 *   An UNCONFIRMED address is never promoted. Otherwise anyone who knows the
 *   owner's email could sign up as it and hold super_admin over every
 *   account on the platform until somebody noticed the unconfirmed signup.
 *   This is the assertion that matters; the rest is housekeeping.
 *
 *   The address comes from the session Supabase verified, not from the
 *   profiles row. A profile column is data. An authenticated identity is not.
 *
 *   Nobody is ever demoted. Clearing the variable stops future grants; it
 *   does not strip the role from anyone holding it, so a typo in an
 *   environment variable cannot lock every administrator out of the console.
 *
 *   node tests/owner-account/run.js
 */
const path = require('path').resolve(__dirname, '..', '..', 'api', '_lib', 'require-user.js');
const Module = require('module');
const orig = Module._load;
let patched = null;
Module._load = function (req, parent, isMain) {
  if (String(req).endsWith('supabase-rest.js')) {
    return { sbRest: async (u, k, m, p, body) => { patched = { m, p, body }; return { ok: true, status: 200, data: [{}] }; },
             isUuid: () => true };
  }
  return orig(req, parent, isMain);
};
const { applyOwnerEmail } = require(path);

const CONFIRMED   = { id: 'u1', email: 'Owner@Example.com', email_confirmed_at: '2026-01-01T00:00:00Z' };
const UNCONFIRMED = { id: 'u2', email: 'owner@example.com' };
const OTHER       = { id: 'u3', email: 'someone@else.com', email_confirmed_at: '2026-01-01T00:00:00Z' };

async function run(label, env, user, profile, expectRole, expectWrite) {
  patched = null;
  process.env.OWNER_EMAIL = env;
  const out = await applyOwnerEmail('http://x', 'k', user, profile);
  const wrote = !!patched;
  const ok = out.role === expectRole && wrote === expectWrite;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(52)} role=${String(out.role)} wrote=${wrote}`);
  return ok;
}

(async () => {
  let all = true;
  all &= await run('confirmed owner, case/space insensitive → promoted', ' owner@example.com ', CONFIRMED, {role:'user'}, 'super_admin', true);
  all &= await run('UNCONFIRMED owner email → NOT promoted',             'owner@example.com',  UNCONFIRMED, {role:'user'}, 'user', false);
  all &= await run('a different account → untouched',                    'owner@example.com',  OTHER, {role:'user'}, 'user', false);
  all &= await run('already super_admin → no redundant write',           'owner@example.com',  CONFIRMED, {role:'super_admin'}, 'super_admin', false);
  all &= await run('OWNER_EMAIL unset → nothing happens',                '',                   CONFIRMED, {role:'user'}, 'user', false);
  all &= await run('multiple owners, second matches',                    'a@b.com, owner@example.com', CONFIRMED, {role:'user'}, 'super_admin', true);
  all &= await run('existing admin not demoted when env cleared',        '',                   CONFIRMED, {role:'admin'}, 'admin', false);
  console.log(all ? '\nALL PASS' : '\nFAILURES');
  process.exit(all ? 0 : 1);
})();
