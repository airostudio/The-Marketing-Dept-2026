/**
 * Brand Kit auto-detect — "as we have the website url, grab the logo and
 * colors and as much other info that it can before the user needs to do all
 * the work" (api/brand-kit-auto-detect.js + api/_lib/logo-detect.js).
 *
 * Generic auth/CORS gating is covered by tests/paid-endpoints/run.js (it's
 * in that suite's WIDER list, since it fetches an arbitrary caller-supplied
 * URL server-side). This file covers what's specific to it:
 *
 *   1. logo-detect.js's priority order and "never fabricate a URL" contract.
 *   2. Scope ownership is checked before any crawl happens.
 *   3. A detected result is returned for review — nothing is saved to
 *      brand_kits by this endpoint.
 *   4. Undetectable fields produce a warning, not a guessed value.
 *
 *   node tests/brand-kit-auto-detect/run.js
 */
'use strict';

const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');

let failures = 0;
function check(label, ok) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failures++;
}

/* ── logo-detect.js unit tests ─────────────────────────────────────────── */
const { detectLogo } = require(path.join(REPO, 'api/_lib/logo-detect.js'));

(() => {
  console.log('\n──── logo-detect: priority order and no-fabrication ────');

  const withLogoImg = '<html><body><header><img class="site-logo" src="/img/logo.svg"></header></body></html>';
  check('finds an <img> with "logo" in its class', detectLogo(withLogoImg, 'https://acme.test/').logoUrl === 'https://acme.test/img/logo.svg');
  check('reports the right source', detectLogo(withLogoImg, 'https://acme.test/').source === 'img[logo]');

  const withAlt = '<html><body><img alt="Acme Logo" src="brand.png"></body></html>';
  check('matches on alt text too', detectLogo(withAlt, 'https://acme.test/about').logoUrl === 'https://acme.test/brand.png');

  const withOgImage = '<html><head><meta property="og:image" content="https://cdn.acme.test/social-card.png"></head><body><img src="/hero.jpg"></body></html>';
  const ogResult = detectLogo(withOgImage, 'https://acme.test/');
  check('falls back to og:image when no logo <img> exists', ogResult.logoUrl === 'https://cdn.acme.test/social-card.png');
  check('reports og:image as the source', ogResult.source === 'og:image');

  const withAppleTouchIcon = '<html><head><link rel="apple-touch-icon" href="/apple-touch-icon.png"></head><body></body></html>';
  const atiResult = detectLogo(withAppleTouchIcon, 'https://acme.test/');
  check('falls back to apple-touch-icon when no logo img or og:image exists', atiResult.logoUrl === 'https://acme.test/apple-touch-icon.png');

  const withFavicon = '<html><head><link rel="icon" href="/favicon-32.png"></head><body></body></html>';
  check('falls back to an explicit favicon link', detectLogo(withFavicon, 'https://acme.test/').logoUrl === 'https://acme.test/favicon-32.png');

  const bare = '<html><head></head><body><p>Nothing here.</p></body></html>';
  const bareResult = detectLogo(bare, 'https://acme.test/');
  check('a page with no logo signal at all falls back to the default /favicon.ico, not a fabricated guess', bareResult.logoUrl === 'https://acme.test/favicon.ico');
  check('and says so via its source label', /unverified/.test(bareResult.source));

  const relativeToDeepPage = detectLogo('<img class="logo" src="../assets/logo.png">', 'https://acme.test/blog/post-1');
  check('resolves a relative path against the actual page URL, not the origin', relativeToDeepPage.logoUrl === 'https://acme.test/assets/logo.png');

  const badHref = '<img class="logo" src="javascript:alert(1)">';
  check('refuses a non-http(s) scheme rather than returning it', detectLogo(badHref, 'https://acme.test/').logoUrl !== 'javascript:alert(1)');
})();

/* ── api/brand-kit-auto-detect.js integration tests ────────────────────── */

function env() {
  process.env.SUPABASE_URL = 'https://x.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
}

function setup(opts = {}) {
  const ownedProjects = opts.ownedProjects || ['project-mine'];
  const ownedProfiles = opts.ownedProfiles || [];
  const calls = { crawls: [], rehosts: 0 };

  const helperPath = path.join(REPO, 'api/_lib/supabase-rest.js');
  require.cache[helperPath] = {
    id: helperPath, filename: helperPath, loaded: true,
    exports: {
      sbRest: async (u, k, method, p) => {
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
        if (p.startsWith('/intelligence_profile_members')) return { ok: true, status: 200, data: [] };
        return { ok: true, status: 200, data: [] };
      },
    },
  };

  const crawlPath = path.join(REPO, 'api/_lib/nancy-crawl.js');
  require.cache[crawlPath] = {
    id: crawlPath, filename: crawlPath, loaded: true,
    exports: {
      parseTarget: (raw) => new URL(/^https?:\/\//i.test(raw) ? raw : 'https://' + raw),
      crawlSite: async (rawUrl) => {
        calls.crawls.push(rawUrl);
        if (opts.crawlThrows) throw new Error('site is unreachable');
        return {
          origin: new URL(rawUrl).origin,
          pages: [{ url: rawUrl, title: 'Home', text: 'hello' }],
          homepageHtml: opts.html !== undefined ? opts.html : '<html><head><meta property="og:image" content="/logo.png"></head><body><style>.btn{color:#ff6600}</style></body></html>',
          homepageUrl: rawUrl,
          homepageCss: opts.css || '',
        };
      },
    },
  };

  const r2Path = path.join(REPO, 'api/_lib/r2.js');
  require.cache[r2Path] = {
    id: r2Path, filename: r2Path, loaded: true,
    exports: {
      isR2Configured: () => opts.r2Configured !== false,
      uploadToR2: async (key) => { calls.rehosts++; return `https://cdn.test/${key}`; },
    },
  };

  const safeFetchPath = path.join(REPO, 'api/_lib/safe-fetch.js');
  require.cache[safeFetchPath] = {
    id: safeFetchPath, filename: safeFetchPath, loaded: true,
    exports: {
      safeFetch: async () => {
        if (opts.rehostFails) return { ok: false };
        return {
          ok: true,
          headers: { get: () => 'image/png' },
          arrayBuffer: async () => Buffer.from('fake-image-bytes'),
        };
      },
    },
  };

  global.fetch = async (url) => {
    if (String(url).includes('/auth/v1/user')) return { ok: true, json: async () => ({ id: 'user-1' }) };
    throw new Error('unexpected fetch to ' + url);
  };

  ['api/brand-kit-auto-detect.js', 'api/_lib/nancy-colours.js', 'api/_lib/logo-detect.js'].forEach(f => delete require.cache[path.join(REPO, f)]);
  const handler = require(path.join(REPO, 'api/brand-kit-auto-detect.js'));
  return { handler, calls };
}

async function callDetect(handler, body) {
  env();
  let status = 200, payload = null;
  const res = {
    setHeader() {}, status(c) { status = c; return this; },
    json(o) { payload = o; return this; }, end() { return this; },
  };
  await handler({
    method: 'POST',
    headers: { authorization: 'Bearer t', host: 'app.test', 'x-forwarded-for': '10.6.0.1' },
    body: body || {},
  }, res);
  return { status, body: payload };
}

(async () => {
  console.log('\n──── a scope id is checked before any crawl happens ────');
  {
    const { handler, calls } = setup({ ownedProjects: ['project-mine'] });
    const r = await callDetect(handler, { projectId: 'project-someone-elses', url: 'acme.test' });
    check('an unowned project is refused (403)', r.status === 403);
    check('no crawl was attempted', calls.crawls.length === 0);
  }

  console.log('\n──── missing url or scope is rejected before any real work ────');
  {
    const { handler, calls } = setup();
    const r1 = await callDetect(handler, { projectId: 'project-mine' });
    check('missing url is a 400', r1.status === 400);
    const r2 = await callDetect(handler, { url: 'acme.test' });
    check('missing both scope ids is a 400', r2.status === 400);
    check('neither reached the crawler', calls.crawls.length === 0);
  }

  console.log('\n──── a real detection returns proposed values for review, and saves nothing ────');
  {
    const { handler, calls } = setup({ ownedProjects: ['project-mine'] });
    const r = await callDetect(handler, { projectId: 'project-mine', url: 'acme.test' });
    check('the crawl actually ran', calls.crawls.length === 1);
    check('succeeds with a detected object', r.status === 200 && r.body.success === true && !!r.body.detected);
    check('a logo found via og:image is re-hosted to R2 rather than linking the original', /cdn\.test/.test(r.body.detected.logoUrl));
    check('a real colour extracted from the page CSS is returned', r.body.detected.colours.primary === '#ff6600');
    check('the resolved website URL is echoed back', /acme\.test/.test(r.body.detected.websiteUrl));
  }

  console.log('\n──── nothing detectable produces an honest warning, never a fabricated value ────');
  {
    const { handler } = setup({ ownedProjects: ['project-mine'], html: '<html><head></head><body>plain text, no styles, no images</body></html>' });
    const r = await callDetect(handler, { projectId: 'project-mine', url: 'acme.test' });
    check('no colours are invented when none are declared', r.body.detected.colours.primary === undefined);
    check('no fonts are invented when none are declared', r.body.detected.fonts.heading === undefined);
    check('a warning explains why colours are missing', r.body.detected.warnings.some(w => /colour/i.test(w)));
    check('a warning explains why fonts are missing', r.body.detected.warnings.some(w => /font/i.test(w)));
    check('the default-favicon fallback still applies (not "no logo" for a page with a <head>)', !!r.body.detected.logoUrl);
  }

  console.log('\n──── an unreachable site is a diagnosable error, not a silent 500 ────');
  {
    const { handler } = setup({ ownedProjects: ['project-mine'], crawlThrows: true });
    const r = await callDetect(handler, { projectId: 'project-mine', url: 'dead-site.test' });
    check('a 422 naming the real failure', r.status === 422 && /dead-site\.test/.test(r.body.error));
  }

  console.log('\n──── a failed re-host degrades to the original URL with a warning, not a hard failure ────');
  {
    const { handler } = setup({ ownedProjects: ['project-mine'], rehostFails: true });
    const r = await callDetect(handler, { projectId: 'project-mine', url: 'acme.test' });
    check('still succeeds', r.status === 200);
    check('falls back to the original (non-R2) URL', r.body.detected.logoUrl === 'https://acme.test/logo.png' || r.body.detected.logoUrl === 'http://acme.test/logo.png');
    check('and warns that it could not be re-hosted', r.body.detected.warnings.some(w => /re-host/i.test(w)));
  }

  console.log('\n──── the schema and store carry a website_url for re-running detection later ────');
  {
    const fs = require('fs');
    const sql = fs.readFileSync(path.join(REPO, 'supabase-brand-kit.sql'), 'utf8');
    check('brand_kits has a website_url column', /website_url\s+TEXT/.test(sql));
    check('an idempotent ALTER covers an already-installed table', /ADD COLUMN IF NOT EXISTS website_url/.test(sql));

    const store = fs.readFileSync(path.join(REPO, 'web/js/brand-kit-store.js'), 'utf8');
    check('BrandKitStore exposes autoDetect', /autoDetect/.test(store));
    check('getBrandKit returns website_url', /website_url: data\.website_url/.test(store));

    const page = fs.readFileSync(path.join(REPO, 'web/marketing/brand.html'), 'utf8');
    check('brand.html has a "Detect from website" control wired to it', /detectBrandFromWebsite/.test(page) && /BrandKitStore\.autoDetect/.test(page));
  }

  console.log(failures === 0 ? '\nALL ASSERTIONS PASSED\n' : `\n${failures} FAILED\n`);
  process.exit(failures === 0 ? 0 : 1);
})();
