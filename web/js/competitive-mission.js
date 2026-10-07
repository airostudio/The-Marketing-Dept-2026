/**
 * competitive-mission.js — runs Scout's real competitor analysis as a Scotty
 * mission step.
 *
 * One competitor website per request (a crawl and a model call each) so none
 * shares another's time limit: start the report, read each site in turn
 * (api/mission-competitive.js), optionally pull their DataForSEO search data
 * from the existing /api/scout-data endpoint, then ask for the cross-competitor
 * read. Progress is kept server-side, so a retry carries on from the next
 * unread site instead of paying for the earlier ones again.
 *
 * It never guesses who the competitors are: they come from the goal, the
 * person typing them in, or the Business Brain's own competitor list.
 */
(function (root) {
  'use strict';

  const MAX_COMPETITORS = 5;

  function cleanUrl(v) {
    const s = String(v == null ? '' : v).trim().slice(0, 300);
    if (!s) return '';
    try {
      const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
      return /^https?:$/.test(u.protocol) && u.hostname.includes('.') ? u.origin : '';
    } catch { return ''; }
  }

  function sanitizeParams(p) {
    const src = (p && typeof p === 'object') ? p : {};
    const raw = Array.isArray(src.urls) ? src.urls : String(src.urls || '').split(/[\s,]+/);
    const seen = new Set(); const urls = [];
    for (const r of raw) {
      const u = cleanUrl(r);
      if (!u) continue;
      const host = new URL(u).hostname.replace(/^www\./, '');
      if (seen.has(host)) continue;
      seen.add(host); urls.push(u);
      if (urls.length >= MAX_COMPETITORS) break;
    }
    return { urls };
  }

  function describeParams(params) {
    return params.urls.length
      ? `Read ${params.urls.length} competitor website${params.urls.length === 1 ? '' : 's'} and compare how they position themselves.`
      : 'Read the competitors\' websites and compare how they position themselves.';
  }

  function missingInputs(params) {
    return sanitizeParams(params).urls.length ? [] : ['the competitor websites to read (Scout will not guess them)'];
  }

  /** The competitor sites the person already keeps in their Business Brain, if any. */
  function radarUrls() {
    try {
      const radar = root.IntelligenceEngine && root.IntelligenceEngine.radar;
      return radar ? radar.getAll().map(c => c && c.url).filter(Boolean) : [];
    } catch { return []; }
  }

  /**
   * @param {object} task  { params: {urls} }
   * @param {object} opts  { authHeaders, intelProfileId, projectId, missionId, businessContext, language, onStatus, fetchImpl }
   */
  async function runCompetitiveReport(task, opts) {
    const o = opts || {};
    const doFetch = o.fetchImpl || ((...a) => fetch(...a));
    const say = (m) => { if (o.onStatus) o.onStatus(m); };
    const params = sanitizeParams(task.params);
    const missing = missingInputs(params);
    if (missing.length) throw new Error(`Scout needs ${missing.join(' ')} before it can start.`);

    async function post(url, body) {
      const res = await doFetch(url, { method: 'POST', headers: await o.authHeaders(), body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false && !data.ok) {
        const e = new Error(data.error || `Request to ${url} failed (HTTP ${res.status})`);
        e.code = data.code;
        throw e;
      }
      return data;
    }

    const state = task._competitiveState || (task._competitiveState = { competitors: [] });
    if (state.result) return state.result;

    if (!state.artifactId) {
      say('Preparing to read the competitor sites…');
      const started = await post('/api/mission-competitive', {
        action: 'start', competitors: params.urls, businessContext: o.businessContext || '', language: o.language || '',
        projectId: o.projectId || undefined, intelProfileId: o.intelProfileId || undefined, missionId: o.missionId || undefined,
      });
      state.artifactId = started.artifactId;
      state.total = started.competitors.length;
      state.remaining = started.remaining;
    }

    let guard = 0;
    while (state.remaining > 0 && guard++ < MAX_COMPETITORS + 2) {
      const done = state.total - state.remaining;
      say(`Reading competitor ${done + 1} of ${state.total}…`);
      const a = await post('/api/mission-competitive', { action: 'analyze', artifactId: state.artifactId });
      if (!a.processed) break;                           // nothing advanced — don't spin
      state.competitors.push(a.competitor);
      state.remaining = a.remaining;
    }
    if (state.remaining > 0) throw new Error(`Reading the competitor sites stalled with ${state.remaining} still to go.`);

    // Search data is a bonus: it needs DataForSEO to be connected, and its
    // absence is reported rather than hidden.
    if (state.seoMetrics === undefined) {
      say('Checking search data…');
      try {
        const hosts = params.urls.map(u => new URL(u).hostname.replace(/^www\./, ''));
        const r = await post('/api/scout-data', { domains: hosts });
        state.seoMetrics = r.metrics || null;
        state.seoNote = r.metrics ? null : 'Search data (DataForSEO) returned nothing for these sites.';
      } catch (e) {
        state.seoMetrics = null;
        state.seoNote = `Search data was not available (${e.message}).`;
      }
    }

    say('Writing the comparison…');
    const fin = await post('/api/mission-competitive', { action: 'finish', artifactId: state.artifactId, seoMetrics: state.seoMetrics || undefined });
    state.result = fin.status === 'empty'
      ? { artifactId: state.artifactId, status: 'empty', note: fin.note, competitors: state.competitors, complete: true }
      : {
        artifactId: state.artifactId, status: fin.status, title: fin.title, markdown: fin.markdown,
        review: fin.review || { approved: false, unsupportedNumbers: [] }, competitors: state.competitors,
        seoNote: state.seoNote || null, complete: true,
      };
    return state.result;
  }

  const api = { runCompetitiveReport, sanitizeParams, describeParams, missingInputs, radarUrls, MAX_COMPETITORS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CompetitiveMission = api;
})(typeof window !== 'undefined' ? window : globalThis);
