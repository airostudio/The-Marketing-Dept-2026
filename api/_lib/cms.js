/**
 * api/_lib/cms.js — publish to a business's own website: WordPress,
 * Webflow, Shopify, Wix, and GoDaddy.
 *
 * Each connector has:
 *   verify(input)          check the login really works and can publish, and
 *                          work out what is needed to publish (blog, collection,
 *                          fields). Returns { label, siteUrl, config, secret }.
 *   publish(conn, post, { status: 'publish'|'draft' })
 *                          → { url, remoteId, status }
 *   update(conn, remoteId, post)  change a post already on the site (refreshes)
 *   ping(conn)             is the login still accepted? (throws if not)
 *   listPages(conn)        the site's own posts/pages (for internal links;
 *                          best-effort, never throws)
 *   findExisting(conn, post)  (not GoDaddy) the post already there
 *                          under this slug, so a retry never posts twice
 *
 * Errors carry .status and .kind ('auth', 'rate_limited', 'transient',
 * 'unsupported', 'permanent') so the autopilot knows whether to retry, slow
 * down, or ask the business to reconnect. A publish never follows a
 * redirect: a site that moved is told to the business, not guessed at.
 *
 * GoDaddy: sites built with GoDaddy's Website Builder have no publishing API.
 * A GoDaddy-hosted WordPress site uses the WordPress connector. For Website
 * Builder sites, publish() throws kind 'unsupported' and the autopilot hands
 * the business a ready-to-paste post instead.
 */

'use strict';

const { validateTarget } = require('./safe-fetch.js');
const md = require('./markdown.js');

const SHOPIFY_VERSION = () => process.env.SHOPIFY_API_VERSION || '2025-01';
const str = (v, n) => String(v == null ? '' : v).trim().slice(0, n);

function fail(message, status, kind, extra = {}) {
  const e = new Error(message); e.status = status; e.kind = kind; Object.assign(e, extra); return e;
}

/** A failed HTTP response → an error with the right kind. */
async function httpFail(res, who) {
  let detail = '';
  try { const b = await res.json(); detail = (b && (b.message || (b.error && (b.error.message || b.error)) || b.errors && JSON.stringify(b.errors) || b.msg || b.code)) || ''; } catch { /* not JSON */ }
  detail = String(detail || '').slice(0, 300);
  const s = res.status;
  const retryAfter = Number(res.headers && res.headers.get && res.headers.get('retry-after'));
  if (s === 401 || s === 403) return fail(`${who} refused the login${detail ? `: ${detail}` : ''}`, s, 'auth');
  if (s === 429) return fail(`${who} is rate limiting${detail ? `: ${detail}` : ''}`, s, 'rate_limited', { retryAfterMs: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : null });
  if (s >= 500 || s === 408) return fail(`${who} had a server error (${s})${detail ? `: ${detail}` : ''}`, s, 'transient');
  if (s >= 300 && s < 400) return fail(`${who} redirected to ${res.headers.get('location') || 'another address'}. Update the site address in Connections.`, s, 'permanent');
  return fail(`${who} said no (${s})${detail ? `: ${detail}` : ''}`, s, 'permanent');
}

async function call(url, init, who, deps = {}) {
  let res;
  try { res = await (deps.fetch || fetch)(url, { redirect: 'manual', signal: AbortSignal.timeout(30000), ...init }); }
  catch (e) { throw fail(`${who} could not be reached: ${e.message}`, 0, 'transient'); }
  if (!res.ok) throw await httpFail(res, who);
  return res.json().catch(() => ({}));
}

/** A business's own site address: public only, normalised to its origin. */
async function publicOrigin(raw, deps = {}) {
  let s = str(raw, 300);
  if (!s) throw fail('Enter the website address.', 400, 'permanent');
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  const v = await (deps.validateTarget || validateTarget)(s);
  if (!v.ok) throw fail(`That website address can't be used: ${v.reason}.`, 400, 'permanent');
  return v.url.origin;
}

const decode = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();

/* ── WordPress (incl. GoDaddy Managed WordPress) ───────────────────────── */
const wordpress = {
  label: 'WordPress',
  needs: ['siteUrl', 'username', 'appPassword'],
  help: 'In WordPress: Users → Profile → Application Passwords → add one named "Audema". Use your WordPress username and that password (not your normal password). The user needs to be allowed to publish posts.',
  auth(secret) { return 'Basic ' + Buffer.from(`${secret.username}:${String(secret.appPassword).replace(/\s+/g, '')}`).toString('base64'); },
  async verify(input, deps) {
    const origin = await publicOrigin(input.siteUrl, deps);
    const secret = { username: str(input.username, 120), appPassword: str(input.appPassword, 200) };
    if (!secret.username || !secret.appPassword) throw fail('Enter the WordPress username and an application password.', 400, 'permanent');
    let me;
    try { me = await call(`${origin}/wp-json/wp/v2/users/me?context=edit`, { headers: { Authorization: this.auth(secret) } }, 'WordPress', deps); }
    catch (e) { if (e.status === 404) throw fail('This site does not answer as WordPress (its REST API is off or it is not WordPress).', 404, 'permanent'); throw e; }
    if (me.capabilities && me.capabilities.publish_posts === false) throw fail(`The WordPress user "${secret.username}" is not allowed to publish posts. Use an Author, Editor or Administrator.`, 403, 'permanent');
    return { label: `WordPress — ${new URL(origin).hostname}`, siteUrl: origin, config: { userName: me.name || secret.username }, secret };
  },
  async publish(conn, post, opts, deps) {
    const r = await call(`${conn.site_url}/wp-json/wp/v2/posts`, {
      method: 'POST', headers: { Authorization: this.auth(conn.secret), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: post.title, content: md.toHtml(post.markdown, { dropFirstH1: true }), excerpt: post.excerpt, slug: post.slug, status: opts.status === 'draft' ? 'draft' : 'publish' }),
    }, 'WordPress', deps);
    return { url: r.link || null, remoteId: String(r.id || ''), status: r.status || opts.status };
  },
  async update(conn, remoteId, post, deps) {
    const r = await call(`${conn.site_url}/wp-json/wp/v2/posts/${encodeURIComponent(remoteId)}`, {
      method: 'POST', headers: { Authorization: this.auth(conn.secret), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: post.title, content: md.toHtml(post.markdown, { dropFirstH1: true }), excerpt: post.excerpt }),
    }, 'WordPress', deps);
    return { url: r.link || null, remoteId: String(r.id || remoteId) };
  },
  async ping(conn, deps) { await call(`${conn.site_url}/wp-json/wp/v2/users/me`, { headers: { Authorization: this.auth(conn.secret) } }, 'WordPress', deps); },
  /** A post this site already has under the slug (a retry after a timed-out publish must not post twice). */
  async findExisting(conn, post, deps) {
    if (!post.slug) return null;
    const r = await call(`${conn.site_url}/wp-json/wp/v2/posts?slug=${encodeURIComponent(post.slug)}&status=publish,draft,future,pending&_fields=id,link,status`, { headers: { Authorization: this.auth(conn.secret) } }, 'WordPress', deps);
    const p = Array.isArray(r) && r[0];
    return p ? { url: p.link || null, remoteId: String(p.id || ''), status: p.status } : null;
  },
  async listPages(conn, deps) {
    const auth = { headers: { Authorization: this.auth(conn.secret) } };
    const [posts, pages] = await Promise.all([
      call(`${conn.site_url}/wp-json/wp/v2/posts?per_page=20&_fields=title,link`, auth, 'WordPress', deps).catch(() => []),
      call(`${conn.site_url}/wp-json/wp/v2/pages?per_page=15&_fields=title,link`, auth, 'WordPress', deps).catch(() => []),
    ]);
    return [...(posts || []), ...(pages || [])].map(p => ({ title: decode(p.title && p.title.rendered), url: p.link })).filter(p => p.title && p.url);
  },
};

/* ── Webflow ──────────────────────────────────────────────────────────── */
const WF = 'https://api.webflow.com/v2';
const webflow = {
  label: 'Webflow',
  needs: ['token'],
  help: 'In Webflow: Site settings → Apps & integrations → API access → generate a site token with CMS read/write and Sites read. Your site needs a blog (a CMS collection with a rich-text field).',
  headers(secret) { return { Authorization: `Bearer ${secret.token}`, accept: 'application/json' }; },
  async verify(input, deps) {
    const secret = { token: str(input.token, 300) };
    if (!secret.token) throw fail('Enter the Webflow site API token.', 400, 'permanent');
    const h = { headers: this.headers(secret) };
    const sites = (await call(`${WF}/sites`, h, 'Webflow', deps)).sites || [];
    const site = sites.find(s => s.id === input.siteId) || sites[0];
    if (!site) throw fail('That token cannot see any Webflow site.', 403, 'auth');
    const cols = (await call(`${WF}/sites/${site.id}/collections`, h, 'Webflow', deps)).collections || [];
    const col = cols.find(c => c.id === input.collectionId) || cols.find(c => /blog|post|article|news/i.test(`${c.slug} ${c.displayName}`));
    if (!col) throw fail(`No blog collection was found on ${site.displayName}. Create a CMS collection for blog posts in Webflow, then connect again.`, 400, 'permanent');
    const detail = await call(`${WF}/collections/${col.id}`, h, 'Webflow', deps);
    const fields = detail.fields || [];
    const rich = fields.filter(f => f.type === 'RichText');
    const body = rich.find(f => /body|content|post/i.test(f.slug)) || rich[0];
    if (!body) throw fail(`The "${col.displayName}" collection has no rich-text field for the article body.`, 400, 'permanent');
    const plain = fields.filter(f => f.type === 'PlainText' && !['name', 'slug'].includes(f.slug));
    const summary = plain.find(f => /summary|excerpt|description|intro/i.test(f.slug));
    const fillable = new Set(['name', 'slug', body.slug, summary && summary.slug].filter(Boolean));
    const blocking = fields.filter(f => f.isRequired && !fillable.has(f.slug));
    if (blocking.length) throw fail(`The "${col.displayName}" collection requires fields Audema can't fill: ${blocking.map(f => f.displayName).join(', ')}. Make them optional in Webflow, then connect again.`, 400, 'permanent');
    const domain = (site.customDomains && site.customDomains[0] && site.customDomains[0].url) || `${site.shortName}.webflow.io`;
    return {
      label: `Webflow — ${site.displayName}`, siteUrl: `https://${String(domain).replace(/^https?:\/\//, '')}`,
      config: { siteId: site.id, collectionId: col.id, collectionSlug: col.slug, fieldMap: { body: body.slug, summary: summary ? summary.slug : null } },
      secret,
    };
  },
  async publish(conn, post, opts, deps) {
    const c = conn.config, live = opts.status !== 'draft';
    const fieldData = { name: post.title, slug: post.slug, [c.fieldMap.body]: md.toHtml(post.markdown, { dropFirstH1: true }) };
    if (c.fieldMap.summary) fieldData[c.fieldMap.summary] = post.excerpt;
    const r = await call(`${WF}/collections/${c.collectionId}/items${live ? '/live' : ''}`, {
      method: 'POST', headers: { ...this.headers(conn.secret), 'Content-Type': 'application/json' },
      body: JSON.stringify({ isArchived: false, isDraft: !live, fieldData }),
    }, 'Webflow', deps);
    const slug = (r.fieldData && r.fieldData.slug) || post.slug;
    return { url: live ? `${conn.site_url}/${c.collectionSlug}/${slug}` : null, remoteId: String(r.id || ''), status: live ? 'publish' : 'draft' };
  },
  async update(conn, remoteId, post, deps) {
    const c = conn.config;
    const fieldData = { name: post.title, [c.fieldMap.body]: md.toHtml(post.markdown, { dropFirstH1: true }) };
    if (c.fieldMap.summary) fieldData[c.fieldMap.summary] = post.excerpt;
    const r = await call(`${WF}/collections/${c.collectionId}/items/${encodeURIComponent(remoteId)}/live`, { method: 'PATCH', headers: { ...this.headers(conn.secret), 'Content-Type': 'application/json' }, body: JSON.stringify({ fieldData }) }, 'Webflow', deps);
    const slug = (r.fieldData && r.fieldData.slug) || post.slug;
    return { url: slug ? `${conn.site_url}/${c.collectionSlug}/${slug}` : null, remoteId: String(r.id || remoteId) };
  },
  async ping(conn, deps) { await call(`${WF}/collections/${conn.config.collectionId}`, { headers: this.headers(conn.secret) }, 'Webflow', deps); },
  async findExisting(conn, post, deps) {
    if (!post.slug) return null;
    const r = await call(`${WF}/collections/${conn.config.collectionId}/items?slug=${encodeURIComponent(post.slug)}`, { headers: this.headers(conn.secret) }, 'Webflow', deps);
    const i = (r.items || []).find(x => x.fieldData && x.fieldData.slug === post.slug);
    return i ? { url: i.isDraft ? null : `${conn.site_url}/${conn.config.collectionSlug}/${post.slug}`, remoteId: String(i.id || ''), status: i.isDraft ? 'draft' : 'publish' } : null;
  },
  async listPages(conn, deps) {
    const r = await call(`${WF}/collections/${conn.config.collectionId}/items/live?limit=20`, { headers: this.headers(conn.secret) }, 'Webflow', deps).catch(() => ({ items: [] }));
    return (r.items || []).map(i => ({ title: i.fieldData && i.fieldData.name, url: `${conn.site_url}/${conn.config.collectionSlug}/${i.fieldData && i.fieldData.slug}` })).filter(p => p.title);
  },
};

/* ── Shopify ──────────────────────────────────────────────────────────── */
const shopify = {
  label: 'Shopify',
  needs: ['shopDomain', 'token'],
  help: 'In Shopify admin: Settings → Apps and sales channels → Develop apps → create an app named "Audema", give it the read_content and write_content Admin API scopes, install it, and copy the Admin API access token. Enter your store\'s .myshopify.com address.',
  base(conn) { return `https://${conn.config.shop}/admin/api/${SHOPIFY_VERSION()}`; },
  async verify(input, deps) {
    const shop = str(input.shopDomain, 120).toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)) throw fail('Enter the store\'s .myshopify.com address (e.g. my-store.myshopify.com).', 400, 'permanent');
    const secret = { token: str(input.token, 200) };
    if (!secret.token) throw fail('Enter the Admin API access token.', 400, 'permanent');
    const h = { headers: { 'X-Shopify-Access-Token': secret.token } };
    const base = `https://${shop}/admin/api/${SHOPIFY_VERSION()}`;
    const info = (await call(`${base}/shop.json`, h, 'Shopify', deps)).shop || {};
    const blogs = (await call(`${base}/blogs.json`, h, 'Shopify', deps)).blogs || [];
    const blog = blogs.find(b => String(b.id) === String(input.blogId)) || blogs.find(b => /news|blog/i.test(b.handle)) || blogs[0];
    if (!blog) throw fail('This store has no blog yet. Create one in Shopify (Online Store → Blog posts → Manage blogs), then connect again.', 400, 'permanent');
    const domain = info.domain || shop;
    return { label: `Shopify — ${info.name || shop}`, siteUrl: `https://${domain}`, config: { shop, blogId: blog.id, blogHandle: blog.handle, author: str(input.author, 80) || info.shop_owner || info.name || 'Team' }, secret };
  },
  async publish(conn, post, opts, deps) {
    const live = opts.status !== 'draft';
    const r = await call(`${this.base(conn)}/blogs/${conn.config.blogId}/articles.json`, {
      method: 'POST', headers: { 'X-Shopify-Access-Token': conn.secret.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ article: { title: post.title, author: conn.config.author, body_html: md.toHtml(post.markdown, { dropFirstH1: true }), summary_html: post.excerpt ? `<p>${post.excerpt.replace(/[<>&]/g, '')}</p>` : undefined, handle: post.slug, published: live } }),
    }, 'Shopify', deps);
    const a = r.article || {};
    return { url: live ? `${conn.site_url}/blogs/${conn.config.blogHandle}/${a.handle || post.slug}` : null, remoteId: String(a.id || ''), status: live ? 'publish' : 'draft' };
  },
  async update(conn, remoteId, post, deps) {
    const r = await call(`${this.base(conn)}/blogs/${conn.config.blogId}/articles/${encodeURIComponent(remoteId)}.json`, {
      method: 'PUT', headers: { 'X-Shopify-Access-Token': conn.secret.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ article: { id: Number(remoteId) || remoteId, title: post.title, body_html: md.toHtml(post.markdown, { dropFirstH1: true }), summary_html: post.excerpt ? `<p>${post.excerpt.replace(/[<>&]/g, '')}</p>` : undefined } }),
    }, 'Shopify', deps);
    const a = r.article || {};
    return { url: a.handle ? `${conn.site_url}/blogs/${conn.config.blogHandle}/${a.handle}` : null, remoteId: String(a.id || remoteId) };
  },
  async ping(conn, deps) { await call(`${this.base(conn)}/blogs/${conn.config.blogId}.json`, { headers: { 'X-Shopify-Access-Token': conn.secret.token } }, 'Shopify', deps); },
  async findExisting(conn, post, deps) {
    if (!post.slug) return null;
    const r = await call(`${this.base(conn)}/blogs/${conn.config.blogId}/articles.json?handle=${encodeURIComponent(post.slug)}&fields=id,handle,published_at`, { headers: { 'X-Shopify-Access-Token': conn.secret.token } }, 'Shopify', deps);
    const a = (r.articles || [])[0];
    return a ? { url: a.published_at ? `${conn.site_url}/blogs/${conn.config.blogHandle}/${a.handle}` : null, remoteId: String(a.id || ''), status: a.published_at ? 'publish' : 'draft' } : null;
  },
  async listPages(conn, deps) {
    const r = await call(`${this.base(conn)}/blogs/${conn.config.blogId}/articles.json?limit=20&fields=title,handle`, { headers: { 'X-Shopify-Access-Token': conn.secret.token } }, 'Shopify', deps).catch(() => ({ articles: [] }));
    return (r.articles || []).map(a => ({ title: a.title, url: `${conn.site_url}/blogs/${conn.config.blogHandle}/${a.handle}` }));
  },
};

/* ── Wix ──────────────────────────────────────────────────────────────── */
const WIX = 'https://www.wixapis.com';
const wix = {
  label: 'Wix',
  needs: ['apiKey', 'siteId'],
  help: 'In your Wix account: Settings → API Keys → generate a key with the "Wix Blog" permission. Your Site ID is in the site dashboard URL (dashboard/<site-id>/…). The site needs the Wix Blog app installed. If Wix asks for an author, add your Member ID from Blog → Writers.',
  headers(secret, config) { return { Authorization: secret.apiKey, 'wix-site-id': config.siteId, 'Content-Type': 'application/json' }; },
  async verify(input, deps) {
    const secret = { apiKey: str(input.apiKey, 2000) };
    const config = { siteId: str(input.siteId, 80), memberId: str(input.memberId, 80) || null };
    if (!secret.apiKey || !/^[0-9a-f-]{36}$/i.test(config.siteId)) throw fail('Enter the Wix API key and the Site ID (a long id like 1a2b3c4d-…).', 400, 'permanent');
    await call(`${WIX}/blog/v3/posts?paging.limit=1`, { headers: this.headers(secret, config) }, 'Wix', deps);
    return { label: 'Wix blog', siteUrl: input.siteUrl ? await publicOrigin(input.siteUrl, deps) : null, config, secret };
  },
  async publish(conn, post, opts, deps) {
    const draftPost = { title: post.title, richContent: md.toRicos(post.markdown, { dropFirstH1: true }), excerpt: post.excerpt, seoSlug: post.slug };
    if (conn.config.memberId) draftPost.memberId = conn.config.memberId;
    let r;
    try {
      r = await call(`${WIX}/blog/v3/draft-posts`, { method: 'POST', headers: this.headers(conn.secret, conn.config), body: JSON.stringify({ draftPost, publish: opts.status !== 'draft', fieldsets: ['URL'] }) }, 'Wix', deps);
    } catch (e) {
      if (e.kind === 'permanent' && /member/i.test(e.message)) throw fail('Wix needs to know which writer the post is by. Add your Wix Member ID to the Wix connection (Blog → Writers), then it will carry on.', 400, 'auth');
      throw e;
    }
    const p = r.draftPost || {};
    const url = p.url && p.url.base ? `${p.url.base.replace(/\/+$/, '')}${p.url.path || ''}` : null;
    return { url: opts.status !== 'draft' ? url : null, remoteId: String(p.id || ''), status: opts.status !== 'draft' ? 'publish' : 'draft' };
  },
  async update(conn, remoteId, post, deps) {
    // Wix edits a post through its draft, then republishes it.
    const draftPost = { id: remoteId, title: post.title, richContent: md.toRicos(post.markdown, { dropFirstH1: true }), excerpt: post.excerpt };
    const r = await call(`${WIX}/blog/v3/draft-posts/${encodeURIComponent(remoteId)}`, { method: 'PATCH', headers: this.headers(conn.secret, conn.config), body: JSON.stringify({ draftPost, action: 'UPDATE_PUBLISH', fieldsets: ['URL'] }) }, 'Wix', deps);
    const p = r.draftPost || {};
    return { url: p.url && p.url.base ? `${p.url.base.replace(/\/+$/, '')}${p.url.path || ''}` : null, remoteId: String(p.id || remoteId) };
  },
  async ping(conn, deps) { await call(`${WIX}/blog/v3/posts?paging.limit=1`, { headers: this.headers(conn.secret, conn.config) }, 'Wix', deps); },
  async findExisting(conn, post, deps) {
    if (!post.slug) return null;
    let r;
    try { r = await call(`${WIX}/blog/v3/posts/slugs/${encodeURIComponent(post.slug)}?fieldsets=URL`, { headers: this.headers(conn.secret, conn.config) }, 'Wix', deps); }
    catch (e) { if (e.status === 404) return null; throw e; }
    const p = r.post;
    return p ? { url: p.url && p.url.base ? `${p.url.base.replace(/\/+$/, '')}${p.url.path || ''}` : null, remoteId: String(p.id || ''), status: 'publish' } : null;
  },
  async listPages(conn, deps) {
    const r = await call(`${WIX}/blog/v3/posts?paging.limit=20&fieldsets=URL`, { headers: this.headers(conn.secret, conn.config) }, 'Wix', deps).catch(() => ({ posts: [] }));
    return (r.posts || []).map(p => ({ title: p.title, url: p.url && p.url.base ? `${p.url.base.replace(/\/+$/, '')}${p.url.path || ''}` : null })).filter(p => p.url);
  },
};

/* ── GoDaddy Website Builder ──────────────────────────────────────────── */
const godaddy = {
  label: 'GoDaddy',
  needs: ['siteUrl'],
  help: 'GoDaddy\'s Website Builder has no way for other apps to publish posts, so Audema prepares each article ready to paste into your GoDaddy blog and tells you when one is ready. If your GoDaddy site runs WordPress (GoDaddy Managed WordPress), connect it as WordPress instead and Audema publishes for you.',
  async verify(input, deps) {
    const origin = await publicOrigin(input.siteUrl, deps);
    return { label: `GoDaddy — ${new URL(origin).hostname}`, siteUrl: origin, config: {}, secret: {} };
  },
  async publish() { throw fail('GoDaddy Website Builder has no publishing API.', 0, 'unsupported'); },
  async update() { throw fail('GoDaddy Website Builder has no publishing API.', 0, 'unsupported'); },
  async ping() { /* nothing to log in to */ },
  async listPages() { return []; },
};

const PROVIDERS = { wordpress, webflow, shopify, wix, godaddy };

module.exports = { PROVIDERS, publicOrigin, httpFail, fail };
