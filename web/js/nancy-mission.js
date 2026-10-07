/**
 * nancy-mission.js — runs Nancy's real pipeline as a Scotty mission step.
 *
 * It calls the same endpoints, in the same order, as the Nancy page
 * (web/agents/nancy-agent.html): research the website, then for each of the
 * seven days write the post and render its image — one slow call per
 * request, driven from here so none shares another's time limit. Every
 * finished day is saved straight to the mission artifact
 * (api/mission-nancy.js), so a retry carries on from the next day instead of
 * paying for the research and earlier images again.
 *
 * What it deliberately does not do, compared with the page: no uploaded
 * photos and no logo overlay (a mission has nobody to supply them), and the
 * personalisation defaults to graphics-only. Nothing is scheduled or
 * published — the finished week waits for approval.
 */
(function (root) {
  'use strict';

  const DAYS = [1, 2, 3, 4, 5, 6, 7];

  function sanitizeParams(p) {
    const src = (p && typeof p === 'object') ? p : {};
    const clean = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
    let websiteUrl = clean(src.websiteUrl, 300);
    if (websiteUrl && !/^https?:\/\//i.test(websiteUrl)) websiteUrl = 'https://' + websiteUrl;
    try { const u = new URL(websiteUrl); websiteUrl = (/^https?:$/.test(u.protocol) && u.hostname.includes('.')) ? u.toString() : ''; } catch { websiteUrl = ''; }
    return { websiteUrl, mustTalkAbout: clean(src.mustTalkAbout, 300) };
  }

  function describeParams(params) {
    return `Research ${params.websiteUrl || '[website]'} and create a week of seven on-brand Instagram posts with finished graphics.`;
  }

  function missingInputs(params) {
    return sanitizeParams(params).websiteUrl ? [] : ['the business website address Nancy should learn from'];
  }

  /**
   * @param {object} task  { params: {websiteUrl, mustTalkAbout} }
   * @param {object} opts  { authHeaders, intelProfileId, projectId, missionId, language, onStatus, fetchImpl }
   * @returns {Promise<{artifactId, status, posts, complete:true}>}
   */
  async function runNancyWeek(task, opts) {
    const o = opts || {};
    const doFetch = o.fetchImpl || ((...a) => fetch(...a));
    const say = (m) => { if (o.onStatus) o.onStatus(m); };
    const params = sanitizeParams(task.params);
    const missing = missingInputs(params);
    if (missing.length) throw new Error(`Nancy needs ${missing.join(' ')} before it can start.`);

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

    const state = task._nancyState || (task._nancyState = { posts: [] });

    /* ── research (once) ─────────────────────────────────────────────── */
    if (!state.artifactId) {
      if (!state.research) {
        say('Reading the website…');
        const site = await post('/api/nancy-analyze-website', { url: params.websiteUrl });
        const businessProfile = site.profile;

        say('Capturing the live site and reading its brand…');
        const shot = await post('/api/nancy-screenshot', { url: params.websiteUrl });
        const brandRes = await post('/api/nancy-brand-identity', {
          origin: shot.origin,
          screenshotDataUri: shot.screenshot && shot.screenshot.available ? shot.screenshot.dataUri : null,
          colourCandidates: shot.colourCandidates, fontHints: shot.fontHints,
        });

        say('Researching the market…');
        const search = await post('/api/nancy-search-competitors', { businessProfile });
        let competitors = [];
        if (search.available) {
          const structured = await post('/api/nancy-structure-competitors', { searchText: search.text, citations: search.citations });
          competitors = structured.competitors || [];
        }

        say('Building the content strategy…');
        const strat = await post('/api/nancy-strategy', { businessProfile, brand: brandRes.brand, competitors });
        state.research = { businessProfile, brand: brandRes.brand, strategy: strat.strategy };
      }

      const started = await post('/api/mission-nancy', {
        action: 'start', websiteUrl: params.websiteUrl, language: o.language || '',
        ...state.research, projectId: o.projectId || undefined,
        intelProfileId: o.intelProfileId || undefined, missionId: o.missionId || undefined,
      });
      state.artifactId = started.artifactId;
    }

    /* ── seven days: write, render, save ─────────────────────────────── */
    const { businessProfile, brand, strategy } = state.research;
    const personalization = {
      goal: '', focusOffer: businessProfile.primary_offer || '',
      faceComfort: 'Mostly graphics',          // no photos in a mission: never ask for a face
      style: '', mustTalkAbout: params.mustTalkAbout,
    };
    const done = new Set(state.posts.map(p => p.day));
    for (const day of DAYS) {
      if (done.has(day)) continue;
      say(`Writing and designing day ${day} of 7…`);
      const priorPosts = state.posts.map(p => ({ day: p.day, objective: p.objective, content_pillar: p.content_pillar, hook: p.hook }));
      const plan = await post('/api/nancy-content-plan', {
        businessProfile, brand, strategy, personalization, previousTopics: [],
        language: o.language || '', dayRange: [day, day], priorPosts,
      });
      const planned = plan.posts && plan.posts[0];
      if (!planned) throw new Error(`Day ${day}'s content plan did not come back with a post.`);
      const rendered = await post('/api/nancy-render-week', {
        post: planned, brand, businessName: businessProfile.business_name, businessProfile, userPhotos: [],
      });
      const saved = await post('/api/mission-nancy', {
        action: 'addPost', artifactId: state.artifactId,
        post: { ...planned, cta_url: planned.cta_url || params.websiteUrl },
        asset: { hostedUrl: rendered.asset && rendered.asset.hostedUrl, format: rendered.asset && rendered.asset.format, fallbackReason: rendered.asset && rendered.asset.fallbackReason },
      });
      state.posts.push({ day, objective: planned.objective, content_pillar: planned.content_pillar, hook: planned.hook,
        slide_headline: planned.slide_headline, caption: planned.caption, hashtags: planned.hashtags || [],
        imageUrl: rendered.asset.hostedUrl, imageFormat: rendered.asset.format, imageFallback: rendered.asset.fallbackReason || null });
      state.status = saved.status;
    }

    state.posts.sort((a, b) => a.day - b.day);
    return { artifactId: state.artifactId, status: state.status || 'pending_approval', posts: state.posts, businessName: businessProfile.business_name, complete: true };
  }

  const api = { runNancyWeek, sanitizeParams, describeParams, missingInputs };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NancyMission = api;
})(typeof window !== 'undefined' ? window : globalThis);
