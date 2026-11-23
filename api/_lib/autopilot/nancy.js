/**
 * api/_lib/autopilot/nancy.js — Nancy's illustrated Instagram week, every
 * week, without anyone pressing a button.
 *
 * The first week is made with the business on Nancy's page: that is where
 * she reads the website, learns the brand and works out the strategy. Every
 * week after, the autopilot reuses that research and does the rest itself:
 *
 *   start   a new week (never repeating a hook from the weeks before)
 *   day     one day at a time: Nancy's plan for that day, then the image
 *           (rendered, text checked, hosted) — the same code as her page
 *   finish  the week waits for approval; approving schedules it one post a
 *           day when "post when I approve" is on, through the business's own
 *           signed-in accounts
 */

'use strict';

const { core: planCore } = require('../../nancy-content-plan.js');
const { core: renderCore } = require('../../nancy-render-week.js');
const { cleanPost } = require('../../mission-nancy.js');
const writingLanguage = require('../writing-language.js');

const WEEK = 7;
const str = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
const scopeFilter = (ap) => (ap.intel_profile_id ? `intel_profile_id=eq.${ap.intel_profile_id}` : `user_id=eq.${ap.user_id}`);
function fault(m, kind, status) { const e = new Error(m); e.kind = kind; if (status) e.status = status; return e; }

/** Run one of Nancy's own endpoints in-process and turn its answer into a result or a fault. */
async function invoke(core, body, who) {
  const out = { code: 200, body: null };
  const res = { setHeader() {}, status(c) { out.code = c; return this; }, json(b) { out.body = b; return this; }, end() { return this; } };
  await core({ method: 'POST', headers: {}, body }, res);
  if (out.code < 300 && out.body && out.body.success !== false) return out.body;
  const msg = `${who}: ${(out.body && out.body.error) || `HTTP ${out.code}`}`;
  if (out.code === 429) throw fault(msg, 'rate_limited', 429);
  if (out.code >= 500 && out.code !== 503) throw fault(msg, 'transient', out.code);
  if (out.code === 503) throw fault(msg, 'not_configured', 503);
  throw fault(msg, out.code === 422 ? 'model' : 'permanent', out.code);
}

const nancy = {
  agent: 'nancy', kind: 'nancy_week', firstStep: 'start', label: 'Nancy\'s week', approvalOnly: true,
  cleanSettings(s) {
    const src = (s && typeof s === 'object') ? s : {};
    return {
      language: writingLanguage.isSupported(src.language) ? src.language : '',
      platforms: [...new Set((Array.isArray(src.platforms) ? src.platforms : []).filter(p => ['Instagram', 'Facebook', 'LinkedIn'].includes(p)))],
      autoSchedule: src.autoSchedule !== false,
      postHour: Number.isInteger(Number(src.postHour)) ? Math.max(0, Math.min(23, Number(src.postHour))) : 11,
    };
  },
  steps: {
    async start({ sb, autopilot }) {
      if (!autopilot) throw fault('This job has no autopilot settings.', 'permanent');
      if (!process.env.ANTHROPIC_API_KEY) throw fault('ANTHROPIC_API_KEY is not configured.', 'not_configured');
      const s = nancy.cleanSettings(autopilot.settings);
      const prior = await sb('GET', `/mission_artifacts?${scopeFilter(autopilot)}&kind=eq.nancy_week&status=in.(approved,pending_approval)&select=id,payload,title&order=created_at.desc&limit=4`);
      const weeks = (prior.ok && prior.data) || [];
      const base = weeks.find(w => w.payload && w.payload.businessProfile && w.payload.brand && w.payload.strategy);
      if (!base) {
        return { done: { skipped: 'no_first_week' }, event: { kind: 'info', title: 'Nancy\'s weekly autopilot starts after your first week', body: 'Make your first illustrated week with Nancy (she reads your website and learns your brand then). From the week after, she makes each new week on her own and asks for your OK.', action: { type: 'link', href: '/agents/nancy-agent.html' } } };
      }
      const p = base.payload;
      const previousTopics = weeks.flatMap(w => ((w.payload && w.payload.posts) || []).map(x => str(x.hook || x.slide_headline, 160))).filter(Boolean).slice(0, 40);
      const created = await sb('POST', '/mission_artifacts', {
        user_id: autopilot.user_id, intel_profile_id: autopilot.intel_profile_id || null, mission_id: null,
        agent_key: 'nancy', kind: 'nancy_week', title: `Instagram week — ${str(p.businessProfile.business_name, 80) || 'your business'}`,
        payload: {
          params: { ...(p.params || {}), language: s.language || (p.params && p.params.language) || '', projectId: autopilot.project_id || null, platforms: s.platforms.length ? s.platforms : ((p.params && p.params.platforms) || ['Instagram']) },
          businessProfile: p.businessProfile, brand: p.brand, strategy: p.strategy, posts: [], autopilot: true,
          autoSchedule: s.autoSchedule ? { hour: s.postHour, timezone: (autopilot.cadence && autopilot.cadence.timezone) || 'UTC' } : null,
        },
        status: 'building',
      });
      if (!created.ok || !created.data || !created.data[0]) throw fault(`Could not start the week (HTTP ${created.status}).`, created.status === 404 ? 'not_configured' : 'transient', created.status);
      return { next: 'day', state: { artifactId: created.data[0].id, previousTopics, language: s.language || (p.params && p.params.language) || '' } };
    },

    async day({ state, sb, deps }) {
      const a = await sb('GET', `/mission_artifacts?id=eq.${state.artifactId}&select=*&limit=1`);
      const art = a.ok && a.data && a.data[0];
      if (!art || art.status !== 'building') throw fault('The week being built was removed or already decided.', 'permanent');
      const pl = art.payload || {};
      const posts = Array.isArray(pl.posts) ? pl.posts : [];
      const d = posts.length + 1;
      if (d > WEEK) return { next: 'finish' };
      const plan = await invoke(deps.planCore || planCore, { businessProfile: pl.businessProfile, brand: pl.brand, strategy: pl.strategy, previousTopics: state.previousTopics || [], dayRange: [d, d], priorPosts: posts.map(x => ({ day: x.day, objective: x.objective, hook: x.hook, content_pillar: x.content_pillar })), language: state.language || '' }, 'Nancy\'s plan');
      const post = (plan.posts || []).find(x => Number(x.day) === d);
      if (!post) throw fault(`Nancy's plan came back without day ${d}.`, 'model');
      const render = await invoke(deps.renderCore || renderCore, { post, brand: pl.brand, businessName: pl.businessProfile.business_name || '', businessProfile: pl.businessProfile, userPhotos: [] }, 'Nancy\'s image');
      const asset = render.asset || {};
      if (!/^https:\/\//.test(asset.hostedUrl || '')) throw fault('Image hosting (R2) is not configured, so the week\'s images have nowhere to live and couldn\'t be posted.', 'not_configured');
      const cleaned = cleanPost(post);
      if (cleaned.error) throw fault(`Day ${d}: ${cleaned.error}`, 'model');
      const next = posts.filter(x => x.day !== d).concat([{ ...cleaned.post, imageUrl: asset.hostedUrl, imageFormat: str(asset.format, 10), imageFallback: asset.fallbackReason ? str(asset.fallbackReason, 200) : null }]).sort((x, y) => x.day - y.day);
      const u = await sb('PATCH', `/mission_artifacts?id=eq.${art.id}&status=eq.building`, { payload: { ...pl, posts: next }, updated_at: new Date().toISOString() });
      if (!u.ok) throw fault(`Could not save day ${d} (HTTP ${u.status}).`, 'transient', u.status);
      return next.length >= WEEK ? { next: 'finish' } : { next: 'day' };
    },

    async finish({ state, sb }) {
      const u = await sb('PATCH', `/mission_artifacts?id=eq.${state.artifactId}&status=eq.building`, { status: 'pending_approval', updated_at: new Date().toISOString() });
      const art = u.ok && u.data && u.data[0];
      if (!art) throw fault('The week couldn\'t be marked ready.', 'permanent');
      const pl = art.payload || {};
      const fallbacks = (pl.posts || []).filter(p => p.imageFormat === 'svg').length;
      return {
        done: { artifactId: art.id },
        event: {
          kind: 'needs_approval', title: `Ready for your OK: ${art.title}`,
          body: `Seven illustrated posts for the week${fallbacks ? ` (${fallbacks} with a designed template image because the AI image couldn't be used)` : ''}. ${pl.autoSchedule ? `Approving posts them one a day at ${String(pl.autoSchedule.hour).padStart(2, '0')}:00 through your signed-in accounts.` : 'Approving puts them in your Content Calendar, ready to schedule.'}`,
          action: { type: 'artifact', artifactId: art.id, kind: 'nancy_week' },
        },
      };
    },
  },
  stepLabel: (s) => ({ start: 'starting the week', day: 'making a day\'s post', finish: 'finishing the week' }[s] || s),
};

module.exports = nancy;
