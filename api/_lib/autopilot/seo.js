/**
 * api/_lib/autopilot/seo.js — SEO Autopilot: on its schedule, picks a topic
 * the business can win, writes the article, checks it, and publishes it to
 * the business's own website (or asks first, while it is earning trust).
 *
 * Steps (one slow call each, so each fits in one serverless run):
 *   profile  — the business's SEO profile: the latest saved one, or read
 *              their website now
 *   topic    — the next planned topic (the business's own list first, then
 *              real search volume, then easiest to rank); proposes new ones
 *              when the plan runs out, never repeating a written one
 *   write    — writes the article, allowed to link only to the site's own
 *              real pages
 *   check    — unfilled placeholders, links that aren't the site's own
 *              (removed), compliance rules (claims, banned phrases…), length
 *   decide   — saves the draft; waits for approval while trust is being
 *              earned, when the mode is "always approve", or when a check
 *              found something critical
 *   publish  — publishes to the connected site; GoDaddy Website Builder gets
 *              a ready-to-paste post instead
 */

'use strict';

const engine = require('../seo-engine.js');
const md = require('../markdown.js');
const { findBracketPlaceholders } = require('../content-guard.js');
const { codeFindings } = require('../compliance-screen.js');
const { PROVIDERS } = require('../cms.js');
const connections = require('./connections.js');

const LABEL = 'SEO Autopilot';
const MIN_WORDS = 400;
const str = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
const scopeFilter = (ap) => (ap.intel_profile_id ? `intel_profile_id=eq.${ap.intel_profile_id}` : ap.project_id ? `project_id=eq.${ap.project_id}` : `user_id=eq.${ap.user_id}`);
// Saved topics: real search volume first (bigger first), then real difficulty (easier first).
const savedOrder = (a, b) => ((b.search_volume != null) - (a.search_volume != null)) || ((a.difficulty ?? 50) - (b.difficulty ?? 50)) || (Number(b.search_volume || 0) - Number(a.search_volume || 0));
// Freshly proposed topics only have the model's estimates: easiest first, then larger.
const DIFF_RANK = { low: 0, medium: 1, high: 2 };
const SIZE_RANK = (t) => (/high/i.test(t.est_search_volume || '') ? 0 : /medium/i.test(t.est_search_volume || '') ? 1 : 2);
const freshOrder = (a, b) => ((DIFF_RANK[a.est_difficulty] ?? 1) - (DIFF_RANK[b.est_difficulty] ?? 1)) || (SIZE_RANK(a) - SIZE_RANK(b));

function noAutopilot() { const e = new Error('This job has no autopilot settings.'); e.kind = 'permanent'; return e; }

const steps = {
  async profile({ state, sb, autopilot, deps }) {
    if (!autopilot) throw noAutopilot();
    if (state.profile && state.runId) return { next: 'topic' };
    const latest = await sb('GET', `/seo_runs?${scopeFilter(autopilot)}&user_id=eq.${autopilot.user_id}&status=eq.ready&select=*&order=created_at.desc&limit=1`);
    const run = latest.ok && latest.data && latest.data[0];
    if (run && run.business_summary) {
      const profile = { business_summary: run.business_summary, products_services: run.products_services || [], target_customer: run.target_customer, existing_topics: run.existing_topics || [] };
      return { next: 'topic', state: { runId: run.id, profile, siteUrl: run.website_url } };
    }
    // No saved profile: read the business's website now.
    let siteUrl = str(autopilot.settings && autopilot.settings.siteUrl, 300);
    if (!siteUrl && autopilot.connection_id) {
      const c = await sb('GET', `/connections?id=eq.${autopilot.connection_id}&select=site_url&limit=1`);
      siteUrl = (c.ok && c.data && c.data[0] && c.data[0].site_url) || '';
    }
    if (!siteUrl) {
      return { wait: 'permission', resume: 'profile', event: { title: 'SEO Autopilot needs your website address', body: 'Connect your website (or add its address in SEO Autopilot settings) so it can learn what you sell before writing.', action: { type: 'connect', provider: 'website' } } };
    }
    const { profile } = await (deps.seo || engine).analyzeSite(siteUrl);
    const saved = await sb('POST', '/seo_runs', {
      user_id: autopilot.user_id, intel_profile_id: autopilot.intel_profile_id || null, project_id: autopilot.intel_profile_id ? null : (autopilot.project_id || null),
      website_url: siteUrl, business_summary: profile.business_summary, products_services: profile.products_services || [],
      target_customer: profile.target_customer || null, existing_topics: profile.existing_topics || [], status: 'ready',
    });
    if (!saved.ok || !saved.data || !saved.data[0]) { const e = new Error(`Could not save the site profile (HTTP ${saved.status}).`); e.status = saved.status; throw e; }
    return { next: 'topic', state: { runId: saved.data[0].id, profile, siteUrl } };
  },

  async topic({ state, sb, autopilot, deps }) {
    if (state.topic && state.topicId) return { next: 'write' };
    const all = await sb('GET', `/seo_topics?run_id=eq.${state.runId}&select=*&limit=300`);
    const topics = (all.ok && all.data) || [];
    const wanted = ((autopilot.settings && autopilot.settings.topics) || []).map(t => str(t, 200).toLowerCase()).filter(Boolean);
    let planned = topics.filter(t => t.status === 'planned');
    // The business's own list first, in their order.
    const mine = wanted.map(w => planned.find(t => t.topic.toLowerCase() === w || (t.target_keyword || '').toLowerCase() === w)).filter(Boolean);
    const missing = wanted.filter(w => !topics.some(t => t.topic.toLowerCase() === w || (t.target_keyword || '').toLowerCase() === w));
    if (missing.length) {
      const ins = await sb('POST', '/seo_topics', missing.map(w => ({ run_id: state.runId, user_id: autopilot.user_id, topic: w, target_keyword: w, rationale: 'Requested by you', content_pillar: 'Your topics', status: 'planned' })));
      if (ins.ok && ins.data) { planned = planned.concat(ins.data); mine.unshift(...ins.data); }
    }
    let pick = mine[0] || planned.slice().sort(savedOrder)[0];
    if (!pick) {
      // The plan has run out: propose more, never repeating one already written or skipped.
      const fresh = await (deps.seo || engine).proposeTopics({ profile: state.profile, language: (autopilot.settings && autopilot.settings.language) || '', avoid: topics.map(t => t.topic) });
      const seen = new Set(topics.map(t => t.topic.toLowerCase()));
      const rows = fresh.filter(t => t.topic && !seen.has(t.topic.toLowerCase())).sort(freshOrder).map(t => ({ run_id: state.runId, user_id: autopilot.user_id, topic: t.topic, target_keyword: t.target_keyword, data_source: 'estimate', rationale: t.rationale, content_pillar: t.content_pillar, status: 'planned' }));
      if (!rows.length) { const e = new Error('No new topics could be proposed.'); e.kind = 'model'; throw e; }
      const ins = await sb('POST', '/seo_topics', rows);
      if (!ins.ok || !ins.data || !ins.data.length) { const e = new Error(`Could not save new topics (HTTP ${ins.status}).`); e.status = ins.status; throw e; }
      pick = ins.data[0];   // inserted easiest-first
    }
    return { next: 'write', state: { topicId: pick.id, topic: { topic: pick.topic, target_keyword: pick.target_keyword || pick.topic, rationale: pick.rationale, content_pillar: pick.content_pillar } } };
  },

  async write({ state, sb, autopilot, deps }) {
    let siteLinks = [];
    if (autopilot.connection_id) {
      try {
        const conn = await connections.load(sb, autopilot.connection_id);
        siteLinks = (await (deps.providers || PROVIDERS)[conn.provider].listPages(conn, deps)).slice(0, 25);
      } catch { /* internal links are a bonus; publishing will surface a real connection problem */ }
    }
    const s = autopilot.settings || {};
    const article = await (deps.seo || engine).writeArticle({ topic: state.topic, profile: state.profile, brandVoice: s.brandVoice || (state.profile && state.profile.tone_notes) || '', language: s.language || '', siteLinks });
    return { next: 'check', state: { article, siteLinks, writes: (state.writes || 0) + 1 } };
  },

  async check({ state, autopilot }) {
    const a = { ...state.article };
    const notes = [], critical = [];
    // Links: only the site's own pages. Anything else is removed, keeping the words.
    const allowed = new Set((state.siteLinks || []).map(l => l.url));
    let origin = null; try { origin = state.siteUrl ? new URL(state.siteUrl).origin : null; } catch { /* none */ }
    let removed = 0;
    a.body_markdown = String(a.body_markdown || '').replace(/\[([^\]]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/g, (all, text, url) => {
      let ok = allowed.has(url);
      if (!ok && origin) { try { ok = new URL(url).origin === origin; } catch { ok = false; } }
      if (ok) return all;
      removed++; return text;
    });
    if (removed) notes.push(`Removed ${removed} link${removed === 1 ? '' : 's'} that didn't point to your own site.`);
    const placeholders = findBracketPlaceholders(md.toText(a.body_markdown));
    if (placeholders.length) critical.push(`Unfilled placeholder${placeholders.length === 1 ? '' : 's'}: ${placeholders.slice(0, 3).join(', ')}`);
    const words = (a.body_markdown || '').split(/\s+/).filter(Boolean).length;
    if (words < MIN_WORDS) {
      if ((state.writes || 1) < 2) return { next: 'write', state: { notes: [`The first draft was only ${words} words, so it was rewritten.`] } };
      critical.push(`It is only ${words} words.`);
    }
    const s = autopilot.settings || {};
    const findings = codeFindings({ id: 'a:article', text: `${a.title}\n${a.meta_description}\n\n${md.toText(a.body_markdown)}`, channel: 'article' }, { region: s.region || 'Global', neverSay: s.neverSay || [], competitorNames: s.competitorNames || [] });
    findings.filter(f => f.severity === 'critical').forEach(f => critical.push(`${f.issue} ("${f.quote}")`));
    const warnings = findings.filter(f => f.severity === 'warning').map(f => `${f.issue} ("${f.quote}")`);
    return { next: 'decide', state: { article: a, checks: { critical, warnings, notes: [...(state.notes || []), ...notes], words } } };
  },

  async decide({ state, sb, autopilot, job }) {
    let articleId = state.articleId;
    if (!articleId) {
      const a = state.article;
      const ins = await sb('POST', '/seo_articles', {
        run_id: state.runId, user_id: autopilot.user_id, topic_id: state.topicId, title: str(a.title, 300), meta_description: str(a.meta_description, 400),
        slug: str(a.slug, 200), target_keyword: str(a.target_keyword, 200), body_markdown: a.body_markdown, schema_markup: a.schema_markup, word_count: state.checks.words, status: 'draft',
      });
      if (!ins.ok || !ins.data || !ins.data[0]) { const e = new Error(`Could not save the draft (HTTP ${ins.status}).`); e.status = ins.status; throw e; }
      articleId = ins.data[0].id;
    }
    const c = state.checks;
    const learning = autopilot.mode === 'earn_trust' && autopilot.trust_earned < autopilot.trust_required;
    const why = c.critical.length ? `It needs a look before it goes live: ${c.critical.join(' ')}`
      : autopilot.mode === 'approve' ? 'You asked to approve every article.'
      : learning ? `SEO Autopilot publishes on its own once you've approved ${autopilot.trust_required} articles (${autopilot.trust_earned} so far).` : null;
    if (why) {
      return {
        wait: 'approval', resume: 'publish', state: { articleId },
        event: {
          title: `Ready for your OK: "${state.article.title}"`,
          body: `${why}\n\nKeyword: ${state.article.target_keyword} · ${c.words} words${c.notes.length ? `\n${c.notes.join('\n')}` : ''}${c.warnings.length ? `\n\nWorth checking:\n• ${c.warnings.join('\n• ')}` : ''}`,
          action: { type: 'approve', jobId: job.id, articleId },
        },
      };
    }
    return { next: 'publish', state: { articleId } };
  },

  async publish({ state, sb, autopilot, deps, now, job }) {
    if (!autopilot.connection_id) {
      return { wait: 'permission', resume: 'publish', event: { title: 'Connect your website so SEO Autopilot can publish', body: `"${state.article.title}" is written and checked. Connect your WordPress, Webflow, Shopify, Wix or GoDaddy site under Connections and it publishes straight away.`, action: { type: 'connect', provider: 'website' } } };
    }
    const conn = await connections.load(sb, autopilot.connection_id);
    const provider = (deps.providers || PROVIDERS)[conn.provider];
    const a = state.article;
    const post = { title: a.title, markdown: a.body_markdown, excerpt: a.meta_description, slug: a.slug };
    const status = (autopilot.settings && autopilot.settings.publishAs) === 'draft' ? 'draft' : 'publish';
    let out = null;
    // A retry after a publish that timed out: if the post already went up, don't post it twice.
    if ((job.step_attempts || 0) > 0 && provider.findExisting) {
      try { out = await provider.findExisting(conn, post, deps); } catch { out = null; }
    }
    try { if (!out) out = await provider.publish(conn, post, { status }, deps); }
    catch (e) {
      if (e.kind === 'unsupported') {
        // GoDaddy Website Builder: hand over a ready-to-paste post instead of pretending.
        await sb('PATCH', `/seo_articles?id=eq.${state.articleId}`, { status: 'draft', connection_id: conn.id });
        await sb('PATCH', `/seo_topics?id=eq.${state.topicId}`, { status: 'written' });
        return { done: { manual: true, articleId: state.articleId }, event: { title: `Ready to paste into GoDaddy: "${a.title}"`, body: 'GoDaddy\'s Website Builder can\'t be published to automatically, so the article is ready to copy: open it, copy it, and paste it into a new blog post in GoDaddy.', action: { type: 'copy_article', articleId: state.articleId } } };
      }
      e.connectionId = conn.id; e.connectionLabel = conn.label;
      throw e;
    }
    const at = new Date(now()).toISOString();
    await sb('PATCH', `/seo_articles?id=eq.${state.articleId}`, { status: status === 'draft' ? 'draft' : 'published', published_url: out.url, published_at: status === 'draft' ? null : at, connection_id: conn.id });
    await sb('PATCH', `/seo_topics?id=eq.${state.topicId}`, { status: 'written' });
    await sb('PATCH', `/connections?id=eq.${conn.id}`, { last_ok_at: at });
    return {
      done: { url: out.url, articleId: state.articleId, status },
      event: {
        title: status === 'draft' ? `Saved as a draft on ${conn.label}: "${a.title}"` : `Published on ${conn.label}: "${a.title}"`,
        body: `Keyword: ${a.target_keyword} · ${state.checks.words} words${state.checks.notes.length ? `\n${state.checks.notes.join('\n')}` : ''}`,
        action: out.url ? { type: 'open', url: out.url } : null,
      },
    };
  },
};

const STEP_LABELS = { profile: 'reading your website', topic: 'choosing a topic', write: 'writing the article', check: 'checking the article', decide: 'saving the draft', publish: 'publishing to your website' };

module.exports = { agent: 'seo', kind: 'seo_article', firstStep: 'profile', label: LABEL, steps, stepLabel: (s) => STEP_LABELS[s] || s };
