/**
 * Brand Kit — the account's shared visual staples (logo, colors, fonts),
 * uploaded once and pulled into every ad/creative generation call instead
 * of each generation inventing its own look.
 *
 * api/brand-kit-upload-logo.js's own auth/CORS gate is covered generically
 * by tests/paid-endpoints/run.js (it's in that suite's WIDER list). This
 * file covers what's specific to it:
 *
 *   1. A scope id (projectId/intelProfileId) taken from the request body is
 *      only as safe as the check that the caller actually owns it — the
 *      exact same class of bug fixed elsewhere in this codebase (a scope
 *      check stops the customer next door, not just strangers).
 *   2. File validation (mime type, size, malformed data URI) happens BEFORE
 *      any real R2/Supabase call — no wasted upload or a corrupt row on bad
 *      input.
 *   3. Exactly one row per scope — a second upload PATCHes the existing
 *      brand_kits row rather than creating a duplicate.
 *   4. A missing supabase-brand-kit.sql migration is a diagnosable error,
 *      not a silent 500 — matches the pattern already used for
 *      loadtest-create.js's own "likely cause: the SQL file hasn't been
 *      run" hint.
 *
 *   node tests/brand-kit/run.js
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

const TINY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function env() {
  process.env.SUPABASE_URL = 'https://x.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
  process.env.R2_ACCOUNT_ID = 'acc';
  process.env.R2_ACCESS_KEY_ID = 'key';
  process.env.R2_SECRET_ACCESS_KEY = 'secret';
  process.env.R2_BUCKET_NAME = 'bucket';
  process.env.R2_PUBLIC_BASE_URL = 'https://cdn.test';
}

/**
 * @param {object} opts
 * @param {string[]} [opts.ownedProjects]
 * @param {string[]} [opts.ownedProfiles]
 * @param {object[]} [opts.existingBrandKits] rows the fake DB already has
 * @param {boolean} [opts.r2Configured]
 * @param {boolean} [opts.brandKitSaveFails] simulate the table not existing yet
 */
function setup(opts = {}) {
  const ownedProjects = opts.ownedProjects || ['project-mine'];
  const ownedProfiles = opts.ownedProfiles || [];
  const brandKits = opts.existingBrandKits ? opts.existingBrandKits.slice() : [];
  const calls = { r2Uploads: 0, patches: [], posts: [] };

  const helperPath = path.join(REPO, 'api/_lib/supabase-rest.js');
  require.cache[helperPath] = {
    id: helperPath, filename: helperPath, loaded: true,
    exports: {
      sbRest: async (u, k, method, p, body) => {
        if (p.startsWith('/profiles')) return { ok: true, status: 200, data: [{ id: 'user-1', plan: 'growth', role: 'user' }] };
        if (p.startsWith('/projects')) {
          const m = p.match(/id=eq\.([^&]+)/);
          const id = m && decodeURIComponent(m[1]);
          return { ok: true, status: 200, data: ownedProjects.includes(id) ? [{ id }] : [] };
        }
        if (p.startsWith('/intelligence_profiles?')) {
          const m = p.match(/id=eq\.([^&]+)/);
          const id = m && decodeURIComponent(m[1]);
          return { ok: true, status: 200, data: ownedProfiles.includes(id) ? [{ id }] : [] };
        }
        if (p.startsWith('/intelligence_profile_members')) {
          return { ok: true, status: 200, data: [] };
        }
        if (p.startsWith('/brand_kits')) {
          if (method === 'GET') return { ok: true, status: 200, data: brandKits };
          if (method === 'PATCH') {
            calls.patches.push({ p, body });
            if (opts.brandKitSaveFails) return { ok: false, status: 404, data: { message: 'relation "brand_kits" does not exist' } };
            return { ok: true, status: 200, data: [{ id: brandKits[0]?.id || 'kit-1', ...body }] };
          }
          if (method === 'POST') {
            calls.posts.push({ p, body });
            if (opts.brandKitSaveFails) return { ok: false, status: 404, data: { message: 'relation "brand_kits" does not exist' } };
            return { ok: true, status: 200, data: body.map((r, i) => ({ id: 'kit-new-' + i, ...r })) };
          }
        }
        return { ok: true, status: 200, data: [] };
      },
    },
  };

  const r2Path = path.join(REPO, 'api/_lib/r2.js');
  const r2Configured = opts.r2Configured !== false;
  require.cache[r2Path] = {
    id: r2Path, filename: r2Path, loaded: true,
    exports: {
      isR2Configured: () => r2Configured,
      uploadToR2: async (key) => { calls.r2Uploads++; return `https://cdn.test/${key}`; },
    },
  };

  global.fetch = async (url) => {
    if (String(url).includes('/auth/v1/user')) return { ok: true, json: async () => ({ id: 'user-1' }) };
    throw new Error('unexpected fetch to ' + url);
  };

  delete require.cache[path.join(REPO, 'api/brand-kit-upload-logo.js')];
  const handler = require(path.join(REPO, 'api/brand-kit-upload-logo.js'));
  return { handler, calls };
}

async function callUpload(handler, body) {
  env();
  let status = 200, payload = null;
  const res = {
    setHeader() {}, status(c) { status = c; return this; },
    json(o) { payload = o; return this; }, end() { return this; },
  };
  await handler({
    method: 'POST',
    headers: { authorization: 'Bearer t', host: 'app.test', 'x-forwarded-for': '10.5.0.1' },
    body: body || {},
  }, res);
  return { status, body: payload };
}

(async () => {
  console.log('\n──── a scope id is only as safe as the check that the caller owns it ────');
  {
    const { handler, calls } = setup({ ownedProjects: ['project-mine'] });
    const r = await callUpload(handler, {
      projectId: 'project-someone-elses',
      dataUri: `data:image/png;base64,${TINY_PNG_BASE64}`,
    });
    check('a project the caller does not own is refused (403)', r.status === 403);
    check('nothing is uploaded to R2 for an unowned scope', calls.r2Uploads === 0);
  }
  {
    const { handler, calls } = setup({ ownedProjects: ['project-mine'] });
    const r = await callUpload(handler, {
      projectId: 'project-mine',
      dataUri: `data:image/png;base64,${TINY_PNG_BASE64}`,
    });
    check('the caller\'s own project is accepted', r.status === 200 && r.body.success === true);
    check('and the logo is actually uploaded', calls.r2Uploads === 1);
  }

  console.log('\n──── neither scope id present is rejected before any real work ────');
  {
    const { handler, calls } = setup();
    const r = await callUpload(handler, { dataUri: `data:image/png;base64,${TINY_PNG_BASE64}` });
    check('missing both projectId and intelProfileId is a 400', r.status === 400);
    check('nothing is uploaded', calls.r2Uploads === 0);
  }

  console.log('\n──── file validation happens before any upload ────');
  {
    const { handler, calls } = setup();
    const r1 = await callUpload(handler, { projectId: 'project-mine', dataUri: 'not-a-data-uri' });
    check('a malformed dataUri is rejected (400)', r1.status === 400);

    const r2 = await callUpload(handler, { projectId: 'project-mine', dataUri: 'data:application/pdf;base64,AAAA' });
    check('a disallowed mime type is rejected (400)', r2.status === 400);

    const hugeBase64 = Buffer.alloc(6 * 1024 * 1024).toString('base64'); // over the 5MB cap
    const r3 = await callUpload(handler, { projectId: 'project-mine', dataUri: `data:image/png;base64,${hugeBase64}` });
    check('an oversized file is rejected (413)', r3.status === 413);

    check('none of the above ever reached R2', calls.r2Uploads === 0);
  }

  console.log('\n──── R2 not configured is a clear, diagnosable error, not a silent failure ────');
  {
    const { handler, calls } = setup({ r2Configured: false });
    const r = await callUpload(handler, { projectId: 'project-mine', dataUri: `data:image/png;base64,${TINY_PNG_BASE64}` });
    check('a clear 503 naming what to configure', r.status === 503 && /R2_/.test(r.body.error));
    check('nothing is written to brand_kits either', calls.patches.length === 0 && calls.posts.length === 0);
  }

  console.log('\n──── exactly one row per scope — a second upload updates, not duplicates ────');
  {
    const { handler, calls } = setup({
      ownedProjects: ['project-mine'],
      existingBrandKits: [{ id: 'kit-existing', project_id: 'project-mine', logo_url: 'https://cdn.test/old.png' }],
    });
    const r = await callUpload(handler, { projectId: 'project-mine', dataUri: `data:image/png;base64,${TINY_PNG_BASE64}` });
    check('the upload still succeeds', r.status === 200);
    check('an existing row is PATCHed', calls.patches.length === 1);
    check('not duplicated via POST', calls.posts.length === 0);
  }
  {
    const { handler, calls } = setup({ ownedProjects: ['project-mine'], existingBrandKits: [] });
    const r = await callUpload(handler, { projectId: 'project-mine', dataUri: `data:image/png;base64,${TINY_PNG_BASE64}` });
    check('a first upload for a scope succeeds', r.status === 200);
    check('creates the row via POST', calls.posts.length === 1);
    check('not PATCHed (nothing existed yet)', calls.patches.length === 0);
  }

  console.log('\n──── a missing migration is a diagnosable error, not a bare 500 ────');
  {
    const { handler } = setup({ ownedProjects: ['project-mine'], brandKitSaveFails: true });
    const r = await callUpload(handler, { projectId: 'project-mine', dataUri: `data:image/png;base64,${TINY_PNG_BASE64}` });
    check('the failure is surfaced with a real status code', r.status >= 500);
    check('and names the likely cause', /supabase-brand-kit\.sql/.test(r.body.error));
  }

  console.log('\n──── the schema, migration wiring, and store shape are all present ────');
  {
    const sql = fs.readFileSync(path.join(REPO, 'supabase-brand-kit.sql'), 'utf8');
    check('one brand kit per intelligence profile is enforced', /idx_brand_kits_profile/.test(sql) && /UNIQUE INDEX/.test(sql));
    check('one brand kit per project is enforced', /idx_brand_kits_project/.test(sql));
    check('RLS is enabled', /ALTER TABLE brand_kits ENABLE ROW LEVEL SECURITY/.test(sql));
    check('a viewer cannot write (write policy requires owner/editor)', /role IN \('owner', 'editor'\)/.test(sql));

    const buildScript = fs.readFileSync(path.join(REPO, 'scripts/build-install-all.py'), 'utf8');
    check('the new schema file is wired into the combined installer', /'supabase-brand-kit\.sql'/.test(buildScript));

    const installAll = fs.readFileSync(path.join(REPO, 'supabase-install-all.sql'), 'utf8');
    check('and the combined installer is actually up to date with it', /CREATE TABLE IF NOT EXISTS brand_kits/.test(installAll));

    const store = fs.readFileSync(path.join(REPO, 'web/js/brand-kit-store.js'), 'utf8');
    check('the client store never writes logo_url directly (only the server endpoint, which owns R2 access, does)',
      !/\.update\(\s*\{[^}]*logo_url/.test(store));
    check('getBrandKit degrades to an empty kit rather than throwing when there is no active scope',
      /scoped: false/.test(store));
  }

  console.log('\n──── the two image-generation call sites actually send the brand kit ────');
  {
    const page = fs.readFileSync(path.join(REPO, 'web/agents/social-agent.html'), 'utf8');
    check('social-agent.html loads the brand kit store', /brand-kit-store\.js/.test(page));
    check('generate-ad-image now receives a brand param sourced from the kit',
      /getBrandForGeneration\(\)/.test(page) && /brand: brand\.colours/.test(page));
    check('render-social-image now receives a brand param too',
      /brand: hasBrand \? \{ colours: brand\.colours, fonts: brand\.fonts \}/.test(page));
  }

  console.log(failures === 0 ? '\nALL ASSERTIONS PASSED\n' : `\n${failures} FAILED\n`);
  process.exit(failures === 0 ? 0 : 1);
})();
