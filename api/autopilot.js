/**
 * api/autopilot.js — turn an agent's autopilot on, set its schedule and how
 * much it may do on its own, and answer what it asks (approve / reject).
 *
 * POST { action, ... }   Header: Authorization: Bearer <Supabase access token>
 *   agents  { intelProfileId?|projectId? }        → every agent that can run on autopilot, with its settings
 *   get     { agent, intelProfileId?|projectId? } → settings, this business's connections, recent work
 *   save    { agent, intelProfileId?|projectId?, enabled, cadence, mode, connectionId?, settings }
 *   runNow  { id }                     → start a piece of work now
 *   approve { jobId, edits? }          → publish (edits to title/meta/body are applied first);
 *                                        counts toward earned trust
 *   reject  { jobId, reason? }         → nothing is published; the topic is set aside
 *   retry   { jobId }                  → try a failed job again from where it stopped
 *   article { articleId } | { jobId }  → the article's text (or a job's rewrite), for preview or copy/paste
 */

'use strict';

const { sbRest, isUuid } = require('./_lib/supabase-rest.js');
const { requireUser } = require('./_lib/require-user.js');
const { withFailureReporting } = require('./_lib/report-failure.js');
const { rateLimited } = require('./_lib/rate-limit.js');
const registry = require('./_lib/autopilot/registry.js');
const { nextRunAt, cleanCadence } = require('./_lib/autopilot/schedule.js');
const scope = require('./_lib/autopilot/scope.js');
const activity = require('./_lib/autopilot/activity.js');
const { publicView } = require('./_lib/autopilot/connections.js');
const md = require('./_lib/markdown.js');
const writingLanguage = require('./_lib/writing-language.js');

const MODES = ['earn_trust', 'auto', 'approve'];
const str = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
const list = (v, n, each) => (Array.isArray(v) ? v : String(v || '').split(/\n|,/)).map(x => str(x, each)).filter(Boolean).slice(0, n);

function cleanSettings(agent, s) {
  const src = (s && typeof s === 'object') ? s : {};
  return {
    siteUrl: str(src.siteUrl, 300),
    topics: list(src.topics, 30, 200),
    brandVoice: str(src.brandVoice, 600),
    language: writingLanguage.isSupported(src.language) ? src.language : '',
    region: ['US', 'UK', 'EU', 'AU', 'CA', 'Global'].includes(src.region) ? src.region : 'Global',
    neverSay: list(src.neverSay, 40, 120),
    competitorNames: list(src.competitorNames, 20, 80),
    publishAs: src.publishAs === 'draft' ? 'draft' : 'publish',
  };
}

function jobView(j) {
  const st = j.state || {};
  return { id: j.id, status: j.status, step: j.step, title: (st.article && st.article.title) || (st.topic && st.topic.topic) || null, articleId: st.articleId || null, lastError: j.last_error, repairs: (j.repairs || []).length, result: j.result, createdAt: j.created_at, finishedAt: j.finished_at };
}

module.exports = withFailureReporting('api/autopilot', async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const auth = await requireUser(req, res);
  if (!auth) return;
  if (rateLimited(req, res, { name: 'autopilot', max: 40, windowMs: 60 * 1000, auth })) return;
  const sb = (m, p, b) => sbRest(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, m, p, b);
  const uid = auth.user.id;
  const body = req.body || {};
  const now = new Date();
  const tableError = (r) => (r.status === 404 ? { code: 'not_installed', error: 'Autopilot is not installed. Run supabase-autopilot.sql in the Supabase SQL editor.' } : { code: 'db_error', error: `Database error (HTTP ${r.status}).` });

  async function jobAndAutopilot(jobId) {
    if (!isUuid(jobId)) return { http: 400, err: { error: 'jobId is not a valid id.' } };
    const j = await sb('GET', `/agent_jobs?id=eq.${jobId}&select=*&limit=1`);
    const job = j.ok && j.data && j.data[0];
    if (!job) return { http: 404, err: { error: 'That piece of work was not found.' } };
    const a = job.autopilot_id ? await sb('GET', `/autopilots?id=eq.${job.autopilot_id}&select=*&limit=1`) : null;
    const ap = a && a.ok && a.data && a.data[0];
    const row = ap || { user_id: job.user_id, intel_profile_id: null };
    if (!(await scope.canAct(uid, row, true))) return { http: 404, err: { error: 'That piece of work was not found.' } };
    return { job, ap };
  }

  try {
    if (body.action === 'get' || body.action === 'save') {
      const handler = registry.forAgent(body.agent);
      if (!handler) return res.status(400).json({ error: `"${body.agent}" can't run on autopilot yet.` });
      const s = await scope.scopeFor(uid, body, { requireEdit: body.action === 'save' });
      if (s.err) return res.status(s.err.http).json(s.err);
      const ex = await sb('GET', `/autopilots?${s.filter}&agent=eq.${handler.agent}&select=*&order=created_at.asc&limit=1`);
      if (!ex.ok) return res.status(ex.status === 404 ? 503 : 500).json(tableError(ex));
      let ap = ex.data && ex.data[0];

      if (body.action === 'save') {
        const cadence = cleanCadence(body.cadence);
        // Agents whose work ends in a draft for approval always ask; only SEO can earn the right to publish.
        const mode = handler.approvalOnly ? 'approve' : handler.informOnly ? 'auto' : (MODES.includes(body.mode) ? body.mode : 'earn_trust');
        let connectionId = null;
        if (body.connectionId) {
          if (!isUuid(body.connectionId)) return res.status(400).json({ error: 'connectionId is not a valid id.' });
          const c = await sb('GET', `/connections?id=eq.${body.connectionId}&${s.filter}&status=neq.disconnected&select=id&limit=1`);
          if (!(c.ok && c.data && c.data[0])) return res.status(400).json({ error: 'That connection does not belong to this business.' });
          connectionId = body.connectionId;
        }
        const enabled = body.enabled !== false;
        const row = { enabled, cadence, mode, connection_id: connectionId, settings: handler.cleanSettings ? handler.cleanSettings(body.settings) : cleanSettings(handler.agent, body.settings), next_run_at: enabled ? nextRunAt(cadence, now).toISOString() : null, paused_reason: null };
        const saved = ap ? await sb('PATCH', `/autopilots?id=eq.${ap.id}`, row)
          : await sb('POST', '/autopilots', { user_id: s.ownerId, intel_profile_id: s.intel_profile_id, project_id: s.project_id, agent: handler.agent, ...row });
        if (!saved.ok || !saved.data || !saved.data[0]) return res.status(saved.status === 404 ? 503 : 500).json(tableError(saved));
        ap = saved.data[0];
        // Work that was waiting for a setting (a website, a goal, topics) carries on with the new ones.
        // Work waiting for a specific login to be reconnected keeps waiting for that.
        const resumed = await sb('PATCH', `/agent_jobs?autopilot_id=eq.${ap.id}&status=eq.waiting_permission&state->>waitingFor=is.null`, { status: 'queued', run_at: now.toISOString(), step_attempts: 0 });
        if (resumed.ok && (resumed.data || []).length) {
          await sb('PATCH', `/activity_events?${s.filter}&agent=eq.${handler.agent}&kind=eq.needs_permission&resolved_at=is.null&action->>type=in.(connect,settings)`, { resolved_at: now.toISOString() });
        }
      }
      const conns = await sb('GET', `/connections?${s.filter}&status=neq.disconnected&select=*&order=created_at.desc`);
      const jobs = ap ? await sb('GET', `/agent_jobs?autopilot_id=eq.${ap.id}&select=*&order=created_at.desc&limit=15`) : { ok: true, data: [] };
      return res.json({
        ok: true, agent: handler.agent, label: handler.label,
        autopilot: ap ? { id: ap.id, enabled: ap.enabled, cadence: ap.cadence, mode: ap.mode, trustRequired: ap.trust_required, trustEarned: ap.trust_earned, connectionId: ap.connection_id, settings: ap.settings, nextRunAt: ap.next_run_at, lastRunAt: ap.last_run_at, pausedReason: ap.paused_reason } : null,
        connections: ((conns.ok && conns.data) || []).map(publicView),
        jobs: ((jobs.ok && jobs.data) || []).map(jobView),
      });
    }

    if (body.action === 'agents') {
      const s = await scope.scopeFor(uid, body, { requireEdit: false });
      if (s.err) return res.status(s.err.http).json(s.err);
      const aps = await sb('GET', `/autopilots?${s.filter}&select=*&order=created_at.asc`);
      if (!aps.ok) return res.status(aps.status === 404 ? 503 : 500).json(tableError(aps));
      return res.json({ ok: true, agents: registry.agents().map(a => {
        const ap = (aps.data || []).find(x => x.agent === a.agent);
        return { ...a, autopilot: ap ? { id: ap.id, enabled: ap.enabled, cadence: ap.cadence, mode: ap.mode, settings: ap.settings, nextRunAt: ap.next_run_at, lastRunAt: ap.last_run_at, pausedReason: ap.paused_reason, trustEarned: ap.trust_earned, trustRequired: ap.trust_required } : null };
      }) });
    }

    if (body.action === 'runNow') {
      if (!isUuid(body.id)) return res.status(400).json({ error: 'id is not a valid id.' });
      const a = await sb('GET', `/autopilots?id=eq.${body.id}&select=*&limit=1`);
      const ap = a.ok && a.data && a.data[0];
      if (!ap || !(await scope.canAct(uid, ap))) return res.status(404).json({ error: 'Autopilot not found.' });
      const open = await sb('GET', `/agent_jobs?autopilot_id=eq.${ap.id}&status=in.(queued,running,waiting_approval,waiting_permission)&select=id&limit=1`);
      if (open.ok && (open.data || []).length) return res.status(409).json({ error: 'A piece of work is already in progress. It needs to finish (or be answered) first.' });
      const handler = registry.forAgent(ap.agent);
      const j = await sb('POST', '/agent_jobs', { user_id: ap.user_id, autopilot_id: ap.id, agent: ap.agent, kind: handler.kind, step: handler.firstStep, state: {}, status: 'queued', run_at: now.toISOString() });
      if (!j.ok) return res.status(500).json(tableError(j));
      return res.json({ ok: true, job: jobView(j.data[0]), note: 'Started. It runs in the background over the next few minutes.' });
    }

    if (body.action === 'approve' || body.action === 'reject') {
      const { job, ap, http, err } = await jobAndAutopilot(body.jobId);
      if (err) return res.status(http).json(err);
      if (job.status !== 'waiting_approval') return res.status(409).json({ error: `This is ${job.status.replace('_', ' ')}, so there's nothing to ${body.action}.` });
      const st = job.state || {};
      const resolve = () => sb('PATCH', `/activity_events?job_id=eq.${job.id}&kind=eq.needs_approval&resolved_at=is.null`, { resolved_at: now.toISOString() });
      if (body.action === 'reject') {
        await sb('PATCH', `/agent_jobs?id=eq.${job.id}&status=eq.waiting_approval`, { status: 'cancelled', finished_at: now.toISOString(), result: { rejected: true, reason: str(body.reason, 300) || null } });
        if (st.topicId) await sb('PATCH', `/seo_topics?id=eq.${st.topicId}`, { status: 'skipped' });
        await resolve();
        return res.json({ ok: true, status: 'cancelled', note: 'Nothing was published. That topic is set aside.' });
      }
      let article = st.article;
      const e = body.edits && typeof body.edits === 'object' ? body.edits : null;
      if (e && article) {
        article = { ...article, title: str(e.title, 200) || article.title, meta_description: str(e.meta_description, 320) || article.meta_description, body_markdown: e.body_markdown ? String(e.body_markdown).replace(/\r\n?/g, '\n').slice(0, 60000) : article.body_markdown };
        if (st.articleId) await sb('PATCH', `/seo_articles?id=eq.${st.articleId}`, { title: article.title, meta_description: article.meta_description, body_markdown: article.body_markdown, word_count: article.body_markdown.split(/\s+/).filter(Boolean).length });
      }
      const u = await sb('PATCH', `/agent_jobs?id=eq.${job.id}&status=eq.waiting_approval`, { status: 'queued', run_at: now.toISOString(), step_attempts: 0, state: { ...st, article, approvedBy: uid, approvedAt: now.toISOString() } });
      if (!u.ok || !(u.data || []).length) return res.status(409).json({ error: 'Someone else already answered this.' });
      let trust = null;
      // A refresh of a live article always asks; it doesn't count toward publishing on its own.
      if (ap && ap.mode === 'earn_trust' && job.kind === 'seo_article') {
        trust = Math.min(ap.trust_required, (ap.trust_earned || 0) + 1);
        await sb('PATCH', `/autopilots?id=eq.${ap.id}`, { trust_earned: trust });
      }
      await resolve();
      const handler = registry.forKind(job.kind);
      if (trust != null && ap && trust >= ap.trust_required) {
        await activity.record(sb, { user_id: job.user_id, intel_profile_id: ap.intel_profile_id, project_id: ap.project_id, agent: job.agent, kind: 'info', title: `${handler ? handler.label : 'Autopilot'} now runs on its own`, body: `You've approved ${trust} pieces, so from now on it publishes without asking — unless a check finds something that needs your eye. You can switch back to approving every piece in its settings.` });
      }
      return res.json({ ok: true, status: 'queued', trustEarned: trust, note: 'Approved. It publishes within a few minutes.' });
    }

    if (body.action === 'retry') {
      const { job, err, http } = await jobAndAutopilot(body.jobId);
      if (err) return res.status(http).json(err);
      if (job.status !== 'failed') return res.status(409).json({ error: 'Only work that failed can be retried.' });
      await sb('PATCH', `/agent_jobs?id=eq.${job.id}&status=eq.failed`, { status: 'queued', run_at: now.toISOString(), step_attempts: 0, finished_at: null });
      await sb('PATCH', `/activity_events?job_id=eq.${job.id}&kind=eq.failed&resolved_at=is.null`, { resolved_at: now.toISOString() });
      return res.json({ ok: true, note: 'Trying again from where it stopped.' });
    }

    if (body.action === 'article' && body.jobId) {
      // The rewrite a job is asking about (a refresh isn't saved over the live article until approved).
      const { job, err, http } = await jobAndAutopilot(body.jobId);
      if (err) return res.status(http).json(err);
      const a = (job.state || {}).article;
      if (!a) return res.status(404).json({ error: 'Nothing has been written for this yet.' });
      return res.json({ ok: true, article: { id: null, title: a.title, metaDescription: a.meta_description, slug: a.slug, keyword: a.target_keyword, markdown: a.body_markdown, html: md.toHtml(a.body_markdown, { dropFirstH1: true }), status: job.status, publishedUrl: (job.state.original || {}).url || null, words: (job.state.checks || {}).words || null } });
    }

    if (body.action === 'article') {
      if (!isUuid(body.articleId)) return res.status(400).json({ error: 'articleId is not a valid id.' });
      const a = await sb('GET', `/seo_articles?id=eq.${body.articleId}&select=*&limit=1`);
      const art = a.ok && a.data && a.data[0];
      const run = art ? await sb('GET', `/seo_runs?id=eq.${art.run_id}&select=user_id,intel_profile_id&limit=1`) : null;
      const owner = run && run.ok && run.data && run.data[0];
      if (!art || !(await scope.canAct(uid, owner || { user_id: art.user_id, intel_profile_id: null }, false))) return res.status(404).json({ error: 'Article not found.' });
      return res.json({ ok: true, article: { id: art.id, title: art.title, metaDescription: art.meta_description, slug: art.slug, keyword: art.target_keyword, markdown: art.body_markdown, html: md.toHtml(art.body_markdown, { dropFirstH1: true }), status: art.status, publishedUrl: art.published_url, words: art.word_count } });
    }

    return res.status(400).json({ error: `Unknown action "${body.action}".` });
  } catch (e) {
    return res.status(502).json({ error: e.message });
  }
});
