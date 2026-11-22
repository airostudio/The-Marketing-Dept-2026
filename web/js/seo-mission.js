/**
 * seo-mission.js — runs the SEO agent's real pipeline as a Scotty mission step.
 *
 * It calls the same endpoints, in the same order, as the SEO Content Engine
 * page (web/seo/content-engine.html): analyse the site, research competitors,
 * propose topics, look up real search volumes, then write the best few
 * articles — one slow call per request, driven from here so none shares
 * another's time limit. The finished research is saved to the mission
 * artifact (api/mission-seo.js) and each article as it is written, so a retry
 * carries on from the next article instead of paying for the research again.
 *
 * Honest about its data: a topic only counts as having a real search volume
 * if DataForSEO returned a number for that exact keyword; everything else
 * stays labelled an estimate, and if the volume lookup fails altogether the
 * plan says so rather than pretending.
 *
 * Nothing is published. The finished plan waits for approval, and approving
 * saves it into the SEO Content Engine.
 */
(function (root) {
  'use strict';

  const MAX_ARTICLES = 3;

  function sanitizeParams(p) {
    const src = (p && typeof p === 'object') ? p : {};
    let websiteUrl = String(src.websiteUrl == null ? '' : src.websiteUrl).replace(/\s+/g, ' ').trim().slice(0, 300);
    if (websiteUrl && !/^https?:\/\//i.test(websiteUrl)) websiteUrl = 'https://' + websiteUrl;
    try { const u = new URL(websiteUrl); websiteUrl = (/^https?:$/.test(u.protocol) && u.hostname.includes('.')) ? u.toString() : ''; } catch { websiteUrl = ''; }
    const n = parseInt(src.articleCount, 10);
    return { websiteUrl, articleCount: Math.max(1, Math.min(MAX_ARTICLES, Number.isFinite(n) ? n : 2)) };
  }

  function describeParams(params) {
    return `Research ${params.websiteUrl || '[website]'}'s competitors and keywords, propose content topics, and write ${params.articleCount} full SEO article${params.articleCount === 1 ? '' : 's'}.`;
  }

  function missingInputs(params) {
    return sanitizeParams(params).websiteUrl ? [] : ['the website address the SEO plan is for'];
  }

  /**
   * Which topics deserve an article first: those with a REAL search volume,
   * ranked by volume against difficulty; then the model's own order for the
   * rest. Returns indexes into the topic list.
   */
  function pickTopics(topics, n) {
    const idx = topics.map((t, i) => i);
    const real = idx.filter(i => topics[i].data_source === 'real' && Number.isFinite(topics[i].search_volume));
    real.sort((a, b) => {
      const sa = topics[a].search_volume / ((Number.isFinite(topics[a].difficulty) ? topics[a].difficulty : 50) + 10);
      const sb = topics[b].search_volume / ((Number.isFinite(topics[b].difficulty) ? topics[b].difficulty : 50) + 10);
      return sb - sa;
    });
    const rest = idx.filter(i => !real.includes(i));
    return [...real, ...rest].slice(0, n);
  }

  /**
   * @param {object} task  { params: {websiteUrl, articleCount} }
   * @param {object} opts  { authHeaders, intelProfileId, projectId, missionId, language, onStatus, fetchImpl }
   */
  async function runSeoPlan(task, opts) {
    const o = opts || {};
    const doFetch = o.fetchImpl || ((...a) => fetch(...a));
    const say = (m) => { if (o.onStatus) o.onStatus(m); };
    const params = sanitizeParams(task.params);
    const missing = missingInputs(params);
    if (missing.length) throw new Error(`The SEO agent needs ${missing.join(' ')} before it can start.`);

    async function post(url, body) {
      const res = await doFetch(url, { method: 'POST', headers: await o.authHeaders(), body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) {
        const e = new Error(data.error || `Request to ${url} failed (HTTP ${res.status})`);
        e.code = data.code;
        throw e;
      }
      return data;
    }

    const state = task._seoState || (task._seoState = { articles: [] });

    /* ── research (once) ─────────────────────────────────────────────── */
    if (!state.artifactId) {
      if (!state.research) {
        say('Reading the website…');
        const site = await post('/api/seo-analyze-site', { url: params.websiteUrl });
        const profile = site.profile;

        say('Researching competitors…');
        let competitors = [], gaps = [], competitorsNote = null;
        const search = await post('/api/seo-search-competitors', { profile });
        if (search.available) {
          const s = await post('/api/seo-structure-competitors', { searchText: search.text, citations: search.citations });
          competitors = s.competitors || [];
          gaps = s.cross_competitor_gaps || [];
        } else {
          competitorsNote = search.reason || 'Live competitor research is not connected.';
        }

        say('Finding topics worth writing about…');
        const kw = await post('/api/seo-keyword-research', { profile, competitors, cross_competitor_gaps: gaps, language: o.language || '' });
        let topics = kw.topics || [];

        say('Checking real search volumes…');
        let volumesNote = null;
        try {
          const vol = await post('/api/seo-keyword-volumes', { keywords: topics.map(t => t.target_keyword) });
          if (vol.configured === false) volumesNote = 'Real search volumes are not connected, so every volume here is an estimate.';
          topics = topics.map(t => {
            const real = vol.volumes && vol.volumes[(t.target_keyword || '').toLowerCase()];
            return real ? { ...t, search_volume: real.search_volume, difficulty: real.difficulty, data_source: 'real' } : t;
          });
        } catch (e) {
          volumesNote = `The real search-volume lookup failed (${e.message}), so every volume here is an estimate.`;
        }
        state.research = { profile, competitors, gaps, topics, competitorsNote, volumesNote };
      }

      const r = state.research;
      const started = await post('/api/mission-seo', {
        action: 'start', websiteUrl: params.websiteUrl, profile: r.profile, competitors: r.competitors,
        crossCompetitorGaps: r.gaps, topics: r.topics, articleTarget: params.articleCount, language: o.language || '',
        projectId: o.projectId || undefined, intelProfileId: o.intelProfileId || undefined, missionId: o.missionId || undefined,
      });
      state.artifactId = started.artifactId;
      state.topics = started.topics;               // as cleaned by the server — indexes refer to this list
      state.articleTarget = started.articleTarget;
    }

    /* ── the best few articles: write, then save ─────────────────────── */
    const { profile } = state.research;
    const picks = pickTopics(state.topics, state.articleTarget);
    const done = new Set(state.articles.map(a => a.topicIndex));
    let n = 0;
    for (const idx of picks) {
      n++;
      if (done.has(idx)) continue;
      say(`Writing article ${n} of ${picks.length}: ${state.topics[idx].topic}…`);
      const w = await post('/api/seo-write-article', {
        topic: state.topics[idx], profile, brandVoice: profile.tone_notes, language: o.language || '',
      });
      const saved = await post('/api/mission-seo', { action: 'addArticle', artifactId: state.artifactId, topicIndex: idx, article: w.article });
      state.articles.push({ topicIndex: idx, title: w.article.title, word_count: w.article.word_count, target_keyword: w.article.target_keyword, meta_description: w.article.meta_description });
      state.status = saved.status;
    }

    const r = state.research;
    return {
      artifactId: state.artifactId, status: state.status || 'pending_approval', topics: state.topics,
      articles: state.articles.slice().sort((a, b) => a.topicIndex - b.topicIndex),
      competitors: r.competitors, competitorsNote: r.competitorsNote, volumesNote: r.volumesNote,
      businessSummary: r.profile.business_summary, complete: true,
    };
  }

  const api = { runSeoPlan, sanitizeParams, describeParams, missingInputs, pickTopics, MAX_ARTICLES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SeoMission = api;
})(typeof window !== 'undefined' ? window : globalThis);
