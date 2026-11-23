/**
 * api/_lib/autopilot/search.js — Search report: on its schedule, reads the
 * business's own Search Console data and acts on it.
 *
 *   • how search traffic moved (this 28 days vs the 28 before)
 *   • how each article Audema published is doing, and which are slipping
 *     (a slipping article is refreshed by SEO Autopilot: see seo-refresh.js)
 *   • searches the site already nearly ranks for (position 8–20) that no
 *     article covers go into SEO Autopilot's plan, so it writes them next
 *
 * It changes nothing on the website and nothing in Google, so it doesn't ask
 * first: it reports what it found and what it queued.
 */

'use strict';

const gsc = require('../gsc.js');
const connections = require('./connections.js');

const str = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
const scopeFilter = (ap) => (ap.intel_profile_id ? `intel_profile_id=eq.${ap.intel_profile_id}` : ap.project_id ? `project_id=eq.${ap.project_id}` : `user_id=eq.${ap.user_id}`);
const pct = (a, b) => (b ? Math.round(((a - b) / b) * 100) : null);
const signed = (n) => (n > 0 ? `+${n}` : `${n}`);
const samePage = (a, b) => String(a || '').replace(/\/+$/, '').toLowerCase() === String(b || '').replace(/\/+$/, '').toLowerCase();
const SLIP_POSITIONS = 3;
const SLIP_MIN_IMPRESSIONS = 50;

function noAutopilot() { const e = new Error('This job has no autopilot settings.'); e.kind = 'permanent'; return e; }

const search = {
  agent: 'search', kind: 'search_report', firstStep: 'read', label: 'Search report', informOnly: true,
  cleanSettings(s) {
    const src = (s && typeof s === 'object') ? s : {};
    return { addTopics: src.addTopics !== false, refreshSlipping: src.refreshSlipping !== false };
  },
  steps: {
    async read({ sb, autopilot, deps }) {
      if (!autopilot) throw noAutopilot();
      const s = search.cleanSettings(autopilot.settings);
      const c = await sb('GET', `/connections?${scopeFilter(autopilot)}&provider=eq.gsc&status=neq.disconnected&select=id&order=created_at.desc&limit=1`);
      const row = c.ok && c.data && c.data[0];
      if (!row) {
        return { wait: 'permission', resume: 'read', event: { title: 'Search report needs your Search Console', body: 'Sign in with the Google account that has your site in Search Console (read-only) under Connections, and the report runs straight away.', action: { type: 'connect', provider: 'gsc' } } };
      }
      const conn = await connections.load(sb, row.id);
      const lib = deps.gsc || gsc;
      const [now, before, queries] = [
        await lib.performance(sb, conn, { days: 28, endOffsetDays: 3, dimension: 'page' }, deps),
        await lib.performance(sb, conn, { days: 28, endOffsetDays: 31, dimension: 'page' }, deps),
        await lib.performance(sb, conn, { days: 28, endOffsetDays: 3, dimension: 'query', rowLimit: 250 }, deps),
      ];
      const pages = gsc.compare(now.rows, before.rows);
      await sb('POST', '/search_snapshots', { user_id: autopilot.user_id, intel_profile_id: autopilot.intel_profile_id || null, project_id: autopilot.project_id || null, connection_id: conn.id, property: conn.config.property, period_start: now.startDate, period_end: now.endDate, totals: now.totals, pages: pages.slice(0, 250), queries: queries.rows.slice(0, 250) });

      // Audema's own published articles.
      const arts = await sb('GET', `/seo_articles?user_id=eq.${autopilot.user_id}&status=eq.published&published_url=not.is.null&select=id,title,target_keyword,published_url,published_at,refreshed_at&order=published_at.desc&limit=100`);
      const mine = ((arts.ok && arts.data) || []).map(a => ({ ...a, perf: pages.find(p => samePage(p.page, a.published_url)) || null }));
      const slipping = mine.filter(a => a.perf && a.perf.positionChange != null && a.perf.positionChange <= -SLIP_POSITIONS && a.perf.impressions >= SLIP_MIN_IMPRESSIONS);

      // Searches it nearly ranks for → SEO Autopilot's plan.
      let added = [];
      if (s.addTopics) {
        const run = await sb('GET', `/seo_runs?${scopeFilter(autopilot)}&status=eq.ready&select=id&order=created_at.desc&limit=1`);
        const runId = run.ok && run.data && run.data[0] && run.data[0].id;
        if (runId) {
          const t = await sb('GET', `/seo_topics?run_id=eq.${runId}&select=topic,target_keyword&limit=500`);
          const covered = [...((t.ok && t.data) || []).flatMap(x => [x.topic, x.target_keyword]), ...mine.map(a => a.target_keyword)];
          const picks = gsc.strikingDistance(queries.rows, { covered });
          if (picks.length) {
            const ins = await sb('POST', '/seo_topics', picks.map(q => ({ run_id: runId, user_id: autopilot.user_id, topic: str(q.query, 200), target_keyword: str(q.query, 200), data_source: 'search_console', rationale: `Your site already shows up around position ${q.position} for "${str(q.query, 120)}" (${q.impressions} impressions in 28 days) but has no article on it.`, content_pillar: 'From your Search Console', status: 'planned' })));
            if (ins.ok) added = picks;
          }
        }
      }

      // Slipping articles: SEO Autopilot refreshes one at a time (always with your OK, since it changes a live page).
      let refreshQueued = null;
      if (s.refreshSlipping && slipping.length) {
        const seoAp = await sb('GET', `/autopilots?${scopeFilter(autopilot)}&agent=eq.seo&enabled=eq.true&select=id,connection_id&limit=1`);
        const sa = seoAp.ok && seoAp.data && seoAp.data[0];
        const open = sa ? await sb('GET', `/agent_jobs?autopilot_id=eq.${sa.id}&kind=eq.seo_refresh&status=in.(queued,running,waiting_approval,waiting_permission)&select=id&limit=1`) : null;
        const target = slipping.find(a => !a.refreshed_at || Date.parse(a.refreshed_at) < Date.now() - 60 * 86400000);
        if (sa && sa.connection_id && target && !(open && open.ok && (open.data || []).length)) {
          const j = await sb('POST', '/agent_jobs', { user_id: autopilot.user_id, autopilot_id: sa.id, agent: 'seo', kind: 'seo_refresh', step: 'rewrite', state: { articleId: target.id, perf: target.perf, queries: queries.rows.filter(q => q.position <= 30).slice(0, 40) }, status: 'queued', run_at: new Date().toISOString() });
          if (j.ok) refreshQueued = target;
        }
      }

      const cd = pct(now.totals.clicks, before.totals.clicks || null);
      const up = pages.filter(p => p.positionChange != null && p.impressions >= 20).sort((a, b) => b.positionChange - a.positionChange).slice(0, 3).filter(p => p.positionChange > 0);
      const down = pages.filter(p => p.positionChange != null && p.impressions >= 20).sort((a, b) => a.positionChange - b.positionChange).slice(0, 3).filter(p => p.positionChange < 0);
      const path = (u) => { try { return new URL(u).pathname; } catch { return u; } };
      const lines = [
        `${now.totals.clicks} clicks and ${now.totals.impressions} impressions from Google search (${now.startDate} to ${now.endDate})${cd != null ? `, ${signed(cd)}% clicks on the 28 days before` : ''}. Average position ${now.totals.position}.`,
        up.length ? `\nClimbing:\n${up.map(p => `• ${path(p.page)}: position ${p.before.position} → ${p.position}`).join('\n')}` : '',
        down.length ? `\nSlipping:\n${down.map(p => `• ${path(p.page)}: position ${p.before.position} → ${p.position}`).join('\n')}` : '',
        mine.length ? `\nArticles Audema published: ${mine.filter(a => a.perf).length} of ${mine.length} are getting search impressions.` : '',
        added.length ? `\nAdded to SEO Autopilot's plan (searches you nearly rank for):\n${added.map(q => `• "${q.query}": position ${q.position}, ${q.impressions} impressions`).join('\n')}` : '',
        refreshQueued ? `\n"${refreshQueued.title}" slipped ${Math.abs(refreshQueued.perf.positionChange)} places, so SEO Autopilot is refreshing it. You'll be asked before the live page changes.` : '',
        !now.totals.impressions ? '\nNo search data yet. New sites and newly verified properties take a few days to show up.' : '',
      ].filter(Boolean);
      return {
        done: { totals: now.totals, added: added.length, slipping: slipping.length, refreshQueued: refreshQueued ? refreshQueued.id : null },
        event: { kind: 'done', title: `Search report: ${now.totals.clicks} clicks in 28 days${cd != null ? ` (${signed(cd)}%)` : ''}`, body: lines.join('\n'), action: { type: 'link', href: '/autopilot.html#search' } },
      };
    },
  },
  stepLabel: () => 'reading your Search Console',
};

module.exports = search;
