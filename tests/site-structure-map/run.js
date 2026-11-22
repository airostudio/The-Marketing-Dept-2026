/**
 * api/_lib/site-structure.js / api/site-structure-map.js — mapping a site's
 * REAL page structure, not a guessed list of common paths. This is the
 * discovery step a "rebuild this site" pitch needs before anything can be
 * regenerated: which pages actually exist (sitemap.xml, or real homepage
 * links when there's no sitemap), what's really on each one, and the
 * site's real brand colours/fonts (reusing nancy-colours.js, not a second
 * copy of that logic).
 *
 *   node tests/site-structure-map/run.js
 */
'use strict';

const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
let failures = 0;
function check(label, ok) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failures++;
}

const {
  discoverPageUrls, extractNavigation, extractSections, extractImages, extractMeta,
} = require(path.join(REPO, 'api/_lib/site-structure.js'));

async function withFetch(impl, fn) {
  const real = global.fetch;
  global.fetch = impl;
  try { return await fn(); } finally { global.fetch = real; }
}
// safeFetchText() reads res.body as a web ReadableStream (it wants byte-level
// control so it can cut the response off at maxBytes) — a plain text()/
// arrayBuffer() mock is never actually consulted, so this needs a real stream.
function textResponse(body, { status = 200, contentType = 'application/xml' } = {}) {
  const bytes = Buffer.from(body, 'utf8');
  return {
    ok: status >= 200 && status < 300, status,
    headers: new Map([['content-type', contentType]]),
    url: undefined,
    body: new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } }),
  };
}

(async () => {

console.log('\n──── discovers real pages from sitemap.xml rather than guessing paths ────');
{
  const sitemap = `<?xml version="1.0"?><urlset>
    <url><loc>https://example.com/</loc></url>
    <url><loc>https://example.com/pricing</loc></url>
    <url><loc>https://example.com/careers</loc></url>
  </urlset>`;
  const urls = await withFetch(
    async (url) => String(url).includes('sitemap.xml') ? textResponse(sitemap) : textResponse('', { status: 404 }),
    () => discoverPageUrls('https://example.com', '<html></html>'),
  );
  check('finds the real pages the sitemap actually lists', urls.includes('https://example.com/pricing') && urls.includes('https://example.com/careers'));
  check('never invents a page the sitemap did not list', urls.every(u => ['https://example.com/', 'https://example.com/pricing', 'https://example.com/careers'].includes(u)));
}

console.log('\n──── follows one level of sitemap-index nesting ────');
{
  const index = `<?xml version="1.0"?><sitemapindex>
    <sitemap><loc>https://example.com/sitemap-pages.xml</loc></sitemap>
  </sitemapindex>`;
  const childSitemap = `<?xml version="1.0"?><urlset><url><loc>https://example.com/about</loc></url></urlset>`;
  const urls = await withFetch(async (url) => {
    if (String(url).includes('sitemap-pages.xml')) return textResponse(childSitemap);
    if (String(url).includes('sitemap.xml')) return textResponse(index);
    return textResponse('', { status: 404 });
  }, () => discoverPageUrls('https://example.com', '<html></html>'));
  check('resolves the child sitemap to a real page', urls.includes('https://example.com/about'));
}

console.log('\n──── falls back to the homepage\'s own real links when there is no sitemap ────');
{
  const homepage = `<html><body><nav><a href="/services">Services</a><a href="https://other.com/x">External</a></nav></body></html>`;
  const urls = await withFetch(async () => textResponse('', { status: 404 }), () => discoverPageUrls('https://example.com', homepage));
  check('the homepage itself is always included', urls.includes('https://example.com'));
  check('a real same-origin link from the page is included', urls.includes('https://example.com/services'));
  check('an off-site link is never treated as one of this site\'s pages', !urls.some(u => u.includes('other.com')));
}

console.log('\n──── navigation is read from real <nav>/<header> links only ────');
{
  const html = `<header><a href="/pricing">Pricing</a><a href="#">Skip</a></header><main><a href="/deep-link">Not nav</a></main>`;
  const nav = extractNavigation(html, 'https://example.com');
  check('a real nav link is captured', nav.some(n => n.label === 'Pricing' && n.path === '/pricing'));
  check('an anchor-only "#" link is not treated as a real destination', !nav.some(n => n.path === '#'));
  check('a link outside the nav/header is not counted as navigation', !nav.some(n => n.path === '/deep-link'));
}

console.log('\n──── sections report only real content, with a defensible hero label ────');
{
  const html = `<section><h1>Welcome to Acme</h1><p>We do things.</p><a href="/start">Get started</a></section>
    <section><h2>Our services</h2><p>Details here.</p></section>
    <section></section>`;
  const sections = extractSections(html, true);
  check('the first homepage section is labelled hero — a defensible default, not an invented category', sections[0].type === 'hero');
  check('the real heading/text/cta come through', sections[0].heading === 'Welcome to Acme' && sections[0].ctaText === 'Get started');
  check('a later section keeps its real tag rather than being mislabelled hero', sections[1].type === 'section');
  check('an empty section with no real content is dropped, not reported as a fabricated empty entry', sections.length === 2);
}
{
  const html = `<section><h2>Features</h2><p>Some copy.</p></section>`;
  const sections = extractSections(html, false); // NOT the homepage
  check('the hero label is never applied off the homepage, even at position 0', sections[0].type !== 'hero');
}

console.log('\n──── images resolve to real absolute URLs, deduplicated ────');
{
  const html = `<img src="/logo.png"><img src="/logo.png"><img src="https://cdn.example.com/hero.jpg"><img src="javascript:void(0)">`;
  const images = extractImages(html, 'https://example.com/about');
  check('a relative path resolves against the real page URL', images.includes('https://example.com/logo.png'));
  check('duplicates are not reported twice', images.filter(i => i === 'https://example.com/logo.png').length === 1);
  check('a non-http src is never included', !images.some(i => i.startsWith('javascript:')));
}

console.log('\n──── meta comes from the real tags, blank when genuinely absent ────');
{
  check('reads a real title/description', (() => {
    const m = extractMeta('<title>Acme Co</title><meta name="description" content="We build things">');
    return m.title === 'Acme Co' && m.description === 'We build things';
  })());
  check('a page with no description tag reports one honestly, not a fabricated summary', extractMeta('<title>X</title>').description === '');
}

console.log('\n──── the endpoint requires auth and is registered as a crawler-spend endpoint ────');
{
  const fs = require('fs');
  const src = fs.readFileSync(path.join(REPO, 'api/site-structure-map.js'), 'utf8');
  check('auth-gated', /requireUser/.test(src));
  check('rate-limited', /rateLimited/.test(src));
  const paidTestSrc = fs.readFileSync(path.join(REPO, 'tests/paid-endpoints/run.js'), 'utf8');
  check('covered by the paid/wider-spend endpoint audit', /'site-structure-map'/.test(paidTestSrc));
}

console.log(failures === 0 ? '\nALL ASSERTIONS PASSED\n' : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
})();
