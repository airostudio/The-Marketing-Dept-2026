/**
 * ads-mission.js — runs the Ad Creative Lab's real generator as a Scotty
 * mission step.
 *
 * It calls api/generate-ads.js one platform at a time — exactly how the Ad
 * Creative Lab page does it, because one request for every platform at once
 * is what used to time out — then hands the whole campaign to
 * api/mission-ads.js, which checks every ad against its platform's real copy
 * limits and keeps it for approval. A platform that fails is reported by name
 * and does not sink the platforms that worked; only a campaign with no ads at
 * all is a failed step. A retry re-asks only the platforms that did not
 * finish.
 *
 * Nothing is bought or published — there is no ad account behind this.
 */
(function (root) {
  'use strict';

  const PLATFORMS = ['Meta/Facebook', 'LinkedIn', 'Google Search', 'Google Display', 'Twitter/X', 'TikTok', 'YouTube'];
  const OBJECTIVES = ['Awareness', 'Traffic', 'Leads', 'Conversions', 'Retargeting'];
  const FRAMEWORKS = ['AIDA', 'PAS'];

  function sanitizeParams(p) {
    const src = (p && typeof p === 'object') ? p : {};
    const clean = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
    const platforms = [...new Set((Array.isArray(src.platforms) ? src.platforms : []).filter(x => PLATFORMS.includes(x)))];
    const n = parseInt(src.variants, 10);
    return {
      product: clean(src.product, 400),
      audience: clean(src.audience, 400),
      objective: OBJECTIVES.includes(src.objective) ? src.objective : 'Conversions',
      platforms: platforms.length ? platforms.slice(0, 4) : ['Meta/Facebook'],
      variants: Math.max(2, Math.min(5, Number.isFinite(n) ? n : 3)),
    };
  }

  function describeParams(p) {
    return `Write ${p.variants} ad variants for ${p.platforms.join(', ')} promoting: ${p.product || '[product]'} to ${p.audience || '[audience]'}.`;
  }

  function missingInputs(params) {
    const p = sanitizeParams(params);
    const missing = [];
    if (!p.product) missing.push('what is being advertised');
    if (!p.audience) missing.push('who the audience is');
    return missing;
  }

  /**
   * @param {object} task  { params: {product, audience, objective, platforms, variants} }
   * @param {object} opts  { authHeaders, intelProfileId, projectId, missionId, language, tone, onStatus, fetchImpl }
   */
  async function runAdsCampaign(task, opts) {
    const o = opts || {};
    const doFetch = o.fetchImpl || ((...a) => fetch(...a));
    const say = (m) => { if (o.onStatus) o.onStatus(m); };
    const params = sanitizeParams(task.params);
    const missing = missingInputs(params);
    if (missing.length) throw new Error(`The Ad Creative Lab needs ${missing.join(' and ')} before it can write.`);

    const state = task._adsState || (task._adsState = { byPlatform: {}, failures: {}, notes: [] });
    if (state.artifactId) return state.result;      // a retry never saves (and pays for) a second campaign

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

    let n = 0;
    for (const platform of params.platforms) {
      n++;
      if (state.byPlatform[platform]) continue;
      say(`Writing ${platform} ads (${n} of ${params.platforms.length})…`);
      try {
        const gen = await post('/api/generate-ads', {
          platforms: [platform], objective: params.objective, product: params.product, audience: params.audience,
          models: FRAMEWORKS, tone: o.tone || '', variants: params.variants, language: o.language || '',
        });
        state.byPlatform[platform] = gen.variants || [];
        if (gen.campaignStrategyNote) state.notes.push(gen.campaignStrategyNote);
        delete state.failures[platform];
      } catch (e) {
        state.failures[platform] = e.message;
      }
    }

    const variants = params.platforms.flatMap(p => state.byPlatform[p] || []);
    if (!variants.length) {
      const first = Object.entries(state.failures)[0];
      throw new Error(first ? `No ads could be written — ${first[0]}: ${first[1]}` : 'No ads could be written.');
    }

    say('Checking every ad against its platform\'s limits…');
    const saved = await post('/api/mission-ads', {
      action: 'save', ...params, strategyNote: state.notes.join(' '), variants,
      failures: Object.entries(state.failures).map(([platform, message]) => ({ platform, message })),
      language: o.language || '', projectId: o.projectId || undefined, intelProfileId: o.intelProfileId || undefined, missionId: o.missionId || undefined,
    });
    state.artifactId = saved.artifactId;
    state.result = {
      artifactId: saved.artifactId, status: saved.status, strategyNote: saved.strategyNote || '',
      variants: saved.variants || [], failures: saved.failures || [], usable: saved.usable || 0, params, complete: true,
    };
    return state.result;
  }

  const api = { runAdsCampaign, sanitizeParams, describeParams, missingInputs, PLATFORMS, OBJECTIVES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AdsMission = api;
})(typeof window !== 'undefined' ? window : globalThis);
