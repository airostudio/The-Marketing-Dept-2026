/**
 * api/_lib/autopilot/seo-refresh.js — refresh an article Audema published
 * that is slipping in Google (queued by the Search report, search.js).
 *
 *   rewrite  loads the article, what it ranks for now, and the site profile
 *   write    SEO Autopilot's writer, told to keep the subject and cover the
 *            searches the page actually appears for
 *   check    the same checks as a new article (links, placeholders, claims,
 *            length)
 *   decide   always asks: it changes a page that is already live
 *   update   updates the same post on the website (never a second copy)
 */

'use strict';

const seo = require('./seo.js');
const connections = require('./connections.js');
const { PROVIDERS } = require('../cms.js');

const str = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
function fault(m, kind) { const e = new Error(m); e.kind = kind; return e; }

const refresh = {
  agent: 'seo', kind: 'seo_refresh', firstStep: 'rewrite', label: 'SEO refresh', secondary: true,
  steps: {
    async rewrite({ state, sb, autopilot }) {
      if (!autopilot) throw fault('This job has no autopilot settings.', 'permanent');
      const a = await sb('GET', `/seo_articles?id=eq.${state.articleId}&select=*&limit=1`);
      const art = a.ok && a.data && a.data[0];
      if (!art) throw fault('The article to refresh was deleted.', 'permanent');
      const run = art.run_id ? await sb('GET', `/seo_runs?id=eq.${art.run_id}&select=*&limit=1`) : null;
      const r = run && run.ok && run.data && run.data[0];
      const profile = r ? { business_summary: r.business_summary, products_services: r.products_services || [], target_customer: r.target_customer, existing_topics: r.existing_topics || [] } : {};
      const perf = state.perf || {};
      const queries = (state.queries || []).filter(q => q.query).slice(0, 15).map(q => `"${str(q.query, 80)}" (position ${q.position})`).join(', ');
      const topic = {
        topic: art.title, target_keyword: art.target_keyword || art.title, content_pillar: 'Refresh',
        rationale: `Refresh of a live article that slipped from position ${perf.before ? perf.before.position : '?'} to ${perf.position || '?'}. Keep the same subject and keyword; make it more useful and current than the pages now ranking above it. Searches the site appears for: ${queries || 'not known'}. Do not invent statistics, prices or dates.`,
      };
      return { next: 'write', state: { topic, profile, positions: perf.before ? `${perf.before.position} → ${perf.position}` : null, runId: art.run_id, siteUrl: r ? r.website_url : null, original: { title: art.title, slug: art.slug, remoteId: art.remote_id, url: art.published_url, connectionId: art.connection_id }, writes: 0 } };
    },
    write: (ctx) => seo.steps.write(ctx),
    check: (ctx) => seo.steps.check(ctx),
    async decide({ state, job }) {
      const c = state.checks;
      return {
        wait: 'approval', resume: 'update',
        event: {
          title: `Refresh ready for your OK: "${state.original.title}"`,
          body: `This live article slipped in Google (position ${state.positions || 'down'}), so it was rewritten to win its place back. Approving updates the same post on your website.${c.critical.length ? `\n\nNeeds a look: ${c.critical.join(' ')}` : ''}${c.notes.length ? `\n${c.notes.join('\n')}` : ''}${c.warnings.length ? `\n\nWorth checking:\n• ${c.warnings.join('\n• ')}` : ''}`,
          action: { type: 'approve', jobId: job.id, refresh: true },
        },
      };
    },
    async update({ state, sb, autopilot, deps, now }) {
      const o = state.original;
      const conn = await connections.load(sb, o.connectionId || autopilot.connection_id);
      const provider = (deps.providers || PROVIDERS)[conn.provider];
      const a = state.article;
      const post = { title: a.title, markdown: a.body_markdown, excerpt: a.meta_description, slug: o.slug };
      let remoteId = o.remoteId;
      if (!remoteId && provider.findExisting) { const f = await provider.findExisting(conn, post, deps).catch(() => null); remoteId = f && f.remoteId; }
      if (!remoteId) throw fault(`The original post couldn't be found on ${conn.label}, so nothing was changed.`, 'permanent');
      let out;
      try { out = await provider.update(conn, remoteId, post, deps); }
      catch (e) {
        if (e.kind === 'unsupported') throw fault(`${conn.label} can't be updated automatically.`, 'permanent');
        e.connectionId = conn.id; e.connectionLabel = conn.label; throw e;
      }
      const at = new Date(now()).toISOString();
      await sb('PATCH', `/seo_articles?id=eq.${state.articleId}`, { title: str(a.title, 300), meta_description: str(a.meta_description, 400), body_markdown: a.body_markdown, word_count: state.checks.words, refreshed_at: at, remote_id: out.remoteId || remoteId, published_url: out.url || o.url });
      return { done: { url: out.url || o.url, articleId: state.articleId, refreshed: true }, event: { title: `Refreshed on ${conn.label}: "${a.title}"`, body: 'The live post was updated in place. The next Search report shows whether it climbs back.', action: (out.url || o.url) ? { type: 'open', url: out.url || o.url } : null } };
    },
  },
  stepLabel: (s) => ({ rewrite: 'preparing the refresh', write: 'rewriting the article', check: 'checking the rewrite', decide: 'asking for your OK', update: 'updating the live post' }[s] || s),
};

module.exports = refresh;
