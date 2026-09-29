/**
 * Blade's website-health check now flags a business already running on
 * GoDaddy's Website Builder, Wix, or Squarespace as its own priority
 * signal — these are proven website *buyers*, just locked into (and paying
 * a recurring subscription for) a template they don't fully own, which
 * makes them a qualitatively different lead than a merely-outdated site.
 *
 * This exercises the real HTTP handler (api/blade-website-check.js) end to
 * end with fixture HTML for each platform's real, distinguishing markup,
 * rather than unit-testing an unexported helper — the module doesn't
 * export analyseHtml()/detectPlatform() separately, and the handler's
 * behavior (status code, response shape) is what Blade's UI actually
 * depends on.
 *
 *   node tests/blade-platform-detection/run.js
 */
'use strict';

const path = require('path');
let failures = 0;
function check(label, ok) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failures++;
}

const requireUserPath = require.resolve(path.join(__dirname, '..', '..', 'api/_lib/require-user.js'));
require.cache[requireUserPath] = {
  id: requireUserPath, filename: requireUserPath, loaded: true,
  exports: { requireUser: async () => ({ id: 'caller-1' }) },
};
const rateLimitPath = require.resolve(path.join(__dirname, '..', '..', 'api/_lib/rate-limit.js'));
require.cache[rateLimitPath] = {
  id: rateLimitPath, filename: rateLimitPath, loaded: true,
  exports: { rateLimited: () => false },
};

let mockHtml = '';
let mockUrl = 'https://example.com/';
const safeFetchPath = require.resolve(path.join(__dirname, '..', '..', 'api/_lib/safe-fetch.js'));
require.cache[safeFetchPath] = {
  id: safeFetchPath, filename: safeFetchPath, loaded: true,
  exports: {
    safeFetch: async () => ({
      status: 200,
      url: mockUrl,
      headers: { get: (name) => (name.toLowerCase() === 'content-type' ? 'text/html; charset=utf-8' : null) },
      text: async () => mockHtml,
    }),
  },
};

const handlerPath = path.join(__dirname, '..', '..', 'api/blade-website-check.js');
delete require.cache[require.resolve(handlerPath)];
const handler = require(handlerPath);

function makeRes() {
  const res = { statusCode: 200 };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (d) => { res.body = d; return res; };
  res.setHeader = () => {};
  res.end = () => res;
  return res;
}
async function check_(website, html, finalUrl) {
  mockHtml = html;
  mockUrl = finalUrl || 'https://' + website;
  const res = makeRes();
  await handler({ method: 'POST', headers: { authorization: 'Bearer t' }, body: { website } }, res);
  return res.body;
}

(async () => {
  console.log('\n──── Wix is detected from its real, distinguishing markup ────');
  {
    const body = await check_('acmeplumbing.com', '<html><head><meta name="generator" content="Wix.com Website Builder"></head><body>welcome</body></html>');
    check('platform is identified as wix', body.signals.platform === 'wix');
    check('a reason explains why this is a priority lead', body.reasons.some(r => /Wix/.test(r) && /paying/.test(r)));
  }
  {
    // A site that scrubbed its generator meta tag but still loads Wix's own CDN.
    const body = await check_('acme.com', '<html><body><script src="https://static.wixstatic.com/site.js"></script></body></html>');
    check('wix is still caught via its CDN, not just the generator meta tag', body.signals.platform === 'wix');
  }

  console.log('\n──── Squarespace is detected ────');
  {
    const body = await check_('acme.com', '<html><head><meta name="generator" content="Squarespace"></head><body>x</body></html>');
    check('platform is identified as squarespace', body.signals.platform === 'squarespace');
    check('a reason explains why this is a priority lead', body.reasons.some(r => /Squarespace/.test(r)));
  }

  console.log('\n──── GoDaddy Website Builder is detected ────');
  {
    const body = await check_('acme.com', '<html><head><meta name="generator" content="GoDaddy Website Builder"></head><body>x</body></html>');
    check('platform is identified as godaddy', body.signals.platform === 'godaddy');
  }
  {
    // The unmistakable giveaway: a business that never even set up a custom domain.
    const body = await check_('mybiz.godaddysites.com', '<html><body>hello</body></html>', 'https://mybiz.godaddysites.com/');
    check('a bare .godaddysites.com domain is caught even with no generator tag', body.signals.platform === 'godaddy');
  }

  console.log('\n──── an ordinary custom site is NOT flagged as a platform lead ────');
  {
    const body = await check_('realbusiness.com', '<html><head><meta name="viewport" content="width=device-width"></head><body>A real custom site.</body></html>');
    check('no platform is detected for ordinary custom markup', body.signals.platform === null);
    check('no platform reason is fabricated', !body.reasons.some(r => /paying for a website/.test(r)));
  }

  console.log('\n──── the priority signal fires independently of otherwise looking "modern" ────');
  {
    // A Squarespace site with a viewport tag, HTTPS, and a fresh copyright —
    // by every OTHER heuristic this looks like a fine, modern site. The
    // platform signal must still surface it, because "modern-looking
    // template you don\'t own" is exactly the intended target, not a miss.
    const currentYear = new Date().getFullYear();
    const html = `<html><head><meta name="generator" content="Squarespace"><meta name="viewport" content="width=device-width"></head><body>&copy; ${currentYear} Acme</body></html>`;
    const body = await check_('acme.com', html);
    check('platform is still flagged even though nothing else about the site looks outdated', body.signals.platform === 'squarespace');
  }

  console.log(failures === 0 ? '\nALL ASSERTIONS PASSED\n' : `\n${failures} FAILED\n`);
  process.exit(failures === 0 ? 0 : 1);
})();
