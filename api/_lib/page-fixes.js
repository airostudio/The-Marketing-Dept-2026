/**
 * api/_lib/page-fixes.js — fix the basics on a business's existing pages:
 * the title Google shows, the meta description under it, and images with no
 * alt text.
 *
 *   scanPage(html, url)        what's there and what's wrong
 *   propose(pages, ctx, deps)  fixes written from each page's own words
 *                              (titles, descriptions) and from looking at
 *                              each image (alt text); anything that breaks
 *                              the limits or invents a claim is dropped
 *   APPLY[provider](conn, fix) change it on the site, or throw kind
 *                              'unsupported' with the reason (the business
 *                              then gets it ready to paste)
 *
 * What each platform lets another app change:
 *   WordPress  image alt text (media library); title and description only
 *              when the site uses Rank Math (Yoast keeps them closed)
 *   Shopify    title and description of pages, blog posts and products;
 *              product image alt text
 *   Webflow    title and description of static pages
 *   Wix, GoDaddy  nothing: every fix is handed over ready to paste
 */

'use strict';

const { callClaudeForJSON, asUntrustedContent, UNTRUSTED_CONTENT_RULE } = require('./nancy-claude.js');
const { findBracketPlaceholders } = require('./content-guard.js');

const TITLE_MAX = 60, TITLE_MIN = 15, META_MAX = 158, META_MIN = 70;
const str = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
const decode = (s) => String(s || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
const attr = (tag, name) => { const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i')); return m ? decode(m[2] ?? m[3] ?? m[4] ?? '') : null; };
function fail(message, kind, extra = {}) { const e = new Error(message); e.kind = kind; Object.assign(e, extra); return e; }

/** Title, description, visible text and images of one page, with its problems. */
function scanPage(html, url) {
  const h = String(html || '');
  const title = decode((h.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '').replace(/\s+/g, ' ').trim();
  const metaTag = (h.match(/<meta[^>]+name\s*=\s*["']description["'][^>]*>/i) || [])[0] || '';
  const metaDescription = metaTag ? str(attr(metaTag, 'content'), 500) : '';
  const h1 = decode((h.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const body = (h.match(/<body[^>]*>([\s\S]*)<\/body>/i) || [, h])[1];
  const text = decode(body.replace(/<(script|style|noscript|svg|nav|footer)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim().slice(0, 2500);
  const images = [];
  for (const tag of h.match(/<img\b[^>]*>/gi) || []) {
    const src = attr(tag, 'src') || attr(tag, 'data-src');
    if (!src || /^data:/i.test(src)) continue;
    let abs; try { abs = new URL(src, url).href; } catch { continue; }
    if (!/^https:\/\//.test(abs) || /\.svg(\?|$)/i.test(abs)) continue;
    const alt = attr(tag, 'alt');
    const w = Number(attr(tag, 'width')) || 0;
    if (w && w < 48) continue;   // icons and tracking pixels
    images.push({ src: abs, alt });
  }
  const issues = [];
  if (!title) issues.push({ type: 'title', problem: 'No title' });
  else if (title.length < TITLE_MIN) issues.push({ type: 'title', problem: `Title is only ${title.length} characters` });
  else if (title.length > 65) issues.push({ type: 'title', problem: `Title is ${title.length} characters; Google cuts it off around 60` });
  if (!metaDescription) issues.push({ type: 'meta', problem: 'No meta description' });
  else if (metaDescription.length < META_MIN) issues.push({ type: 'meta', problem: `Meta description is only ${metaDescription.length} characters` });
  else if (metaDescription.length > 165) issues.push({ type: 'meta', problem: `Meta description is ${metaDescription.length} characters; Google cuts it off around 155` });
  // Missing alt attribute only: alt="" is the correct way to mark a decorative image.
  const seen = new Set();
  for (const img of images) if (img.alt === null && !seen.has(img.src)) { seen.add(img.src); issues.push({ type: 'alt', problem: 'Image has no alt text', src: img.src }); }
  return { url, title, metaDescription, h1, text, images, issues };
}

const TEXT_TOOL = {
  name: 'submit_page_fixes',
  description: 'A better title and/or meta description for each page, written only from what the page says.',
  input_schema: {
    type: 'object',
    properties: {
      pages: { type: 'array', items: { type: 'object', properties: {
        index: { type: 'integer' },
        title: { type: 'string', description: `Only if asked for. ${TITLE_MIN}–${TITLE_MAX} characters, the page's main subject first, then the business name if it fits.` },
        meta_description: { type: 'string', description: `Only if asked for. ${META_MIN}–${META_MAX} characters, what the page offers and why click, in plain words.` },
      }, required: ['index'] } },
    },
    required: ['pages'],
  },
};
const ALT_TOOL = {
  name: 'submit_alt_text',
  description: 'Alt text for each image, describing what it shows for someone who can\'t see it.',
  input_schema: { type: 'object', properties: { images: { type: 'array', items: { type: 'object', properties: { index: { type: 'integer' }, alt: { type: 'string', description: 'Under 125 characters. What the image shows, in context. No "image of". Empty string if purely decorative.' } }, required: ['index', 'alt'] } } }, required: ['images'] },
};

/** Numbers, prices, percentages or years in a fix that the page itself doesn't contain. */
function unsupportedFigures(fix, pageText) {
  const figs = String(fix).match(/\$?\d[\d,.]*%?/g) || [];
  return figs.filter(f => !String(pageText).includes(f.replace(/^\$/, '')));
}

/**
 * @param {Array<ReturnType<scanPage>>} pages  scanned pages with issues
 * @param {{businessName?, neverSay?: string[]}} ctx
 * @returns {Promise<Array<{id, page, type, problem, current, value, src?}>>}
 */
async function propose(pages, ctx = {}, deps = {}) {
  const call = deps.callClaude || callClaudeForJSON;
  const fixes = [];
  const never = (ctx.neverSay || []).map(s => String(s).toLowerCase()).filter(Boolean);
  const clean = (v) => !findBracketPlaceholders(v).length && !never.some(n => v.toLowerCase().includes(n));

  const textJobs = pages.map((p, i) => ({ p, i, want: p.issues.filter(x => x.type !== 'alt').map(x => x.type) })).filter(j => j.want.length);
  if (textJobs.length) {
    const r = await call({
      system: `You write page titles and meta descriptions for a small business website. Write ONLY from what each page says: never add a claim, price, number, award, location or service the page doesn't state. ${UNTRUSTED_CONTENT_RULE}`,
      user: `Business: ${str(ctx.businessName, 120) || 'unknown'}\n\n${textJobs.map(j => `PAGE ${j.i}: ${j.p.url}\nWrite: ${j.want.join(' and ')}\nCurrent title: ${j.p.title || '(none)'}\nCurrent description: ${j.p.metaDescription || '(none)'}\nMain heading: ${j.p.h1 || '(none)'}\n${asUntrustedContent(j.p.text.slice(0, 1800))}`).join('\n\n---\n\n')}`,
      tool: TEXT_TOOL, maxTokens: 3000,
    });
    if (!r.success) throw fail(`Couldn't write the fixes: ${r.error}`, /took too long|overloaded|5\d\d/i.test(r.error) ? 'transient' : 'model');
    for (const out of r.data.pages || []) {
      const j = textJobs.find(x => x.i === out.index); if (!j) continue;
      const t = str(out.title, 120), m = str(out.meta_description, 300);
      if (j.want.includes('title') && t && t.length >= TITLE_MIN && t.length <= TITLE_MAX && clean(t) && !unsupportedFigures(t, j.p.text + j.p.title).length) {
        fixes.push({ page: j.p.url, type: 'title', problem: j.p.issues.find(x => x.type === 'title').problem, current: j.p.title, value: t });
      }
      if (j.want.includes('meta') && m && m.length >= META_MIN && m.length <= META_MAX && clean(m) && !unsupportedFigures(m, j.p.text + j.p.metaDescription).length) {
        fixes.push({ page: j.p.url, type: 'meta', problem: j.p.issues.find(x => x.type === 'meta').problem, current: j.p.metaDescription, value: m });
      }
    }
  }

  const alts = pages.flatMap(p => p.issues.filter(x => x.type === 'alt').map(x => ({ page: p, src: x.src }))).slice(0, deps.maxImages || 16);
  for (let k = 0; k < alts.length; k += 8) {
    const batch = alts.slice(k, k + 8);
    const r = await call({
      system: `You write alt text for images on a business website, from what each image visibly shows. Don't guess names, places or brands you can't see. ${UNTRUSTED_CONTENT_RULE}`,
      user: [
        ...batch.flatMap((a, i) => [{ type: 'text', text: `IMAGE ${i} on ${a.page.url} (page heading: ${str(a.page.h1, 120) || 'none'})` }, { type: 'image', source: { type: 'url', url: a.src } }]),
        { type: 'text', text: 'Write alt text for each image above.' },
      ],
      tool: ALT_TOOL, maxTokens: 1500,
    });
    if (!r.success) {
      if (/image|url|download|fetch/i.test(r.error)) continue;   // an image Claude couldn't load: skip it, don't guess
      throw fail(`Couldn't write alt text: ${r.error}`, /took too long|overloaded|5\d\d/i.test(r.error) ? 'transient' : 'model');
    }
    for (const out of r.data.images || []) {
      const a = batch[out.index]; const alt = str(out.alt, 125);
      if (a && alt && clean(alt)) fixes.push({ page: a.page.url, type: 'alt', problem: 'Image has no alt text', current: '', value: alt, src: a.src });
    }
  }
  return fixes.slice(0, 40).map((f, i) => ({ id: `f${i + 1}`, include: true, ...f }));
}

/* ── Applying, per platform ─────────────────────────────────────────── */
const samePage = (a, b) => String(a || '').replace(/[?#].*$/, '').replace(/\/+$/, '').toLowerCase() === String(b || '').replace(/[?#].*$/, '').replace(/\/+$/, '').toLowerCase();
const lastSegment = (u) => { try { return new URL(u).pathname.replace(/\/+$/, '').split('/').pop(); } catch { return ''; } };
const fileStem = (u) => { try { return decodeURIComponent(new URL(u).pathname.split('/').pop()).replace(/\.[a-z0-9]+$/i, '').replace(/-\d+x\d+$/, '').replace(/-scaled$/, ''); } catch { return ''; } };

function makeApply(cms) {
  const { call } = cms;
  return {
    async wordpress(conn, fix, deps) {
      const auth = { Authorization: cms.PROVIDERS.wordpress.auth(conn.secret) };
      if (fix.type === 'alt') {
        const stem = fileStem(fix.src);
        if (!stem) throw fail('The image\'s file name couldn\'t be read.', 'unsupported');
        const found = await call(`${conn.site_url}/wp-json/wp/v2/media?search=${encodeURIComponent(stem)}&per_page=20&_fields=id,source_url`, { headers: auth }, 'WordPress', deps);
        const m = (Array.isArray(found) ? found : []).find(x => fileStem(x.source_url) === stem);
        if (!m) throw fail('This image isn\'t in the WordPress media library (it may come from the theme or another site).', 'unsupported');
        await call(`${conn.site_url}/wp-json/wp/v2/media/${m.id}`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ alt_text: fix.value }) }, 'WordPress', deps);
        return { note: 'Alt text set in the media library (applies wherever this image is used).' };
      }
      const slug = lastSegment(fix.page);
      if (!slug) throw fail('The home page\'s title and description are set in your theme or SEO plugin settings.', 'unsupported');
      let obj = null;
      for (const type of ['pages', 'posts']) {
        const r = await call(`${conn.site_url}/wp-json/wp/v2/${type}?slug=${encodeURIComponent(slug)}&_fields=id,link`, { headers: auth }, 'WordPress', deps).catch(() => []);
        obj = (Array.isArray(r) ? r : []).find(x => samePage(x.link, fix.page)) || obj;
        if (obj) break;
      }
      if (!obj) throw fail('This page couldn\'t be matched to a WordPress page or post.', 'unsupported');
      try {
        await call(`${conn.site_url}/wp-json/rankmath/v1/updateMeta`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ objectType: 'post', objectID: obj.id, meta: { [fix.type === 'title' ? 'rank_math_title' : 'rank_math_description']: fix.value } }) }, 'WordPress', deps);
        return { note: 'Set in Rank Math.' };
      } catch (e) {
        if (e.status === 404 || e.status === 400) throw fail('Your SEO plugin doesn\'t let other apps change titles and descriptions (Rank Math does; Yoast and most others don\'t).', 'unsupported');
        throw e;
      }
    },

    async shopify(conn, fix, deps) {
      const base = cms.PROVIDERS.shopify.base(conn);
      const h = { 'X-Shopify-Access-Token': conn.secret.token, 'Content-Type': 'application/json' };
      let path = ''; try { path = new URL(fix.page).pathname.replace(/\/+$/, ''); } catch { /* none */ }
      const m = path.match(/^\/(pages|products)\/([^/]+)$/) || path.match(/^\/blogs\/([^/]+)\/([^/]+)$/);
      if (!m) throw fail(path ? 'Shopify only lets apps change this for pages, blog posts and products.' : 'The home page\'s title and description are set in Online Store → Preferences.', 'unsupported');
      const kind = path.startsWith('/blogs/') ? 'articles' : m[1];
      const handle = m[2];
      let obj, url;
      if (kind === 'articles') {
        const blogs = (await call(`${base}/blogs.json?fields=id,handle`, { headers: h }, 'Shopify', deps)).blogs || [];
        const blog = blogs.find(b => b.handle === m[1]);
        if (!blog) throw fail('The blog for this post wasn\'t found.', 'unsupported');
        obj = ((await call(`${base}/blogs/${blog.id}/articles.json?handle=${encodeURIComponent(handle)}&fields=id`, { headers: h }, 'Shopify', deps)).articles || [])[0];
        url = obj && `${base}/blogs/${blog.id}/articles/${obj.id}.json`;
      } else {
        obj = (((await call(`${base}/${kind}.json?handle=${encodeURIComponent(handle)}&fields=id${kind === 'products' ? ',images' : ''}`, { headers: h }, 'Shopify', deps))[kind]) || [])[0];
        url = obj && `${base}/${kind}/${obj.id}.json`;
      }
      if (!obj) throw fail('This page couldn\'t be found in Shopify.', 'unsupported');
      const key = kind === 'articles' ? 'article' : kind.slice(0, -1);
      if (fix.type === 'alt') {
        if (kind !== 'products') throw fail('Shopify only lets apps set alt text on product images.', 'unsupported');
        const img = (obj.images || []).find(i => fileStem(i.src) === fileStem(fix.src));
        if (!img) throw fail('This image isn\'t one of the product\'s own images.', 'unsupported');
        await call(`${base}/products/${obj.id}/images/${img.id}.json`, { method: 'PUT', headers: h, body: JSON.stringify({ image: { id: img.id, alt: fix.value } }) }, 'Shopify', deps);
        return { note: 'Set on the product image.' };
      }
      await call(url, { method: 'PUT', headers: h, body: JSON.stringify({ [key]: { id: obj.id, [fix.type === 'title' ? 'metafields_global_title_tag' : 'metafields_global_description_tag']: fix.value } }) }, 'Shopify', deps);
      return { note: 'Set in Shopify\'s search engine listing.' };
    },

    async webflow(conn, fix, deps) {
      if (fix.type === 'alt') throw fail('Webflow doesn\'t let apps change image alt text; set it in the Webflow Designer asset panel.', 'unsupported');
      const h = { ...cms.PROVIDERS.webflow.headers(conn.secret), 'Content-Type': 'application/json' };
      const pages = (await call(`https://api.webflow.com/v2/sites/${conn.config.siteId}/pages?limit=100`, { headers: h }, 'Webflow', deps)).pages || [];
      let path = ''; try { path = new URL(fix.page).pathname.replace(/^\/+|\/+$/g, ''); } catch { /* none */ }
      const page = pages.find(p => (p.slug || '') === path || (path === '' && (p.slug === 'index' || p.slug === '')) || (p.publishedPath || '').replace(/^\/+|\/+$/g, '') === path);
      if (!page) throw fail('Only Webflow static pages can be changed this way (CMS items keep their SEO in their own fields).', 'unsupported');
      try {
        await call(`https://api.webflow.com/v2/pages/${page.id}`, { method: 'PUT', headers: h, body: JSON.stringify({ seo: { [fix.type === 'title' ? 'title' : 'description']: fix.value } }) }, 'Webflow', deps);
      } catch (e) {
        if (e.kind === 'auth') throw fail('The Webflow token can\'t change pages. Reconnect Webflow with a token that has "Pages: read and write".', 'auth', { status: 403 });
        throw e;
      }
      return { note: 'Set on the Webflow page. Publish the site in Webflow for it to go live.' };
    },

    async wix() { throw fail('Wix doesn\'t let apps change page titles, descriptions or alt text.', 'unsupported'); },
    async godaddy() { throw fail('GoDaddy Website Builder doesn\'t let apps change pages.', 'unsupported'); },
  };
}

module.exports = { scanPage, propose, makeApply, unsupportedFigures, TITLE_MAX, META_MAX };
