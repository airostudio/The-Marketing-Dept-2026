/**
 * api/_lib/autopilot/pat.js — Pat's email campaign on a schedule.
 *
 *   draft  Pat writes the campaign from the business's settings (offer, link,
 *          audience, sender) and runs every check Pat's page runs: unfinished
 *          copy, merge tags, the campaign review, one fix pass. Missing
 *          details are asked for, never guessed.
 *   wait   the campaign waits for approval in What happened (approving it
 *          there carries this job on; rejecting it stops it).
 *   send   only when "send when I approve" is on: to the subscribed contacts
 *          with the audience tags, 25 at a time, through Pat's own send path
 *          (suppression list, daily quota, compliance footer, unsubscribe
 *          link). Where it got to is saved after every batch, so a retry
 *          never emails anyone twice; a full daily quota carries on tomorrow.
 */

'use strict';

const { buildCampaign } = require('../pat-pipeline.js');
const { buildMergeFields } = require('../flow-merge.js');
const writingLanguage = require('../writing-language.js');

const BATCH = 25, PER_STEP = 200;
const str = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
const list = (v, n, each) => (Array.isArray(v) ? v : String(v || '').split(/\n|,/)).map(x => str(x, each)).filter(Boolean).slice(0, n);
function fault(m, kind, extra = {}) { const e = new Error(m); e.kind = kind; Object.assign(e, extra); return e; }
const tomorrowMs = (now) => { const d = new Date(now); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 10) - now; };

async function invokeSend(core, body, userId) {
  const out = { code: 200, body: null };
  const res = { setHeader() {}, status(c) { out.code = c; return this; }, json(b) { out.body = b; return this; }, end() { return this; } };
  const base = (process.env.PUBLIC_APP_URL || process.env.APP_BASE_URL || 'https://localhost').replace(/^https?:\/\//, '').replace(/\/+$/, '');
  await core({ method: 'POST', headers: { host: base, 'x-forwarded-proto': 'https' }, body }, res, { userId, profile: null });
  return out;
}

const pat = {
  agent: 'pat', kind: 'pat_campaign', firstStep: 'draft', label: 'Pat\'s campaign', approvalOnly: true,
  cleanSettings(s) {
    const src = (s && typeof s === 'object') ? s : {};
    let cta = str(src.ctaUrl, 300); try { if (cta && !/^https:\/\//i.test(new URL(cta).href)) cta = ''; } catch { cta = ''; }
    return {
      offer: str(src.offer, 600), ctaUrl: cta, audience: str(src.audience, 300), audienceTags: list(src.audienceTags, 10, 60),
      senderName: str(src.senderName, 80), senderTitle: str(src.senderTitle, 80), companyName: str(src.companyName, 120), replyTo: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str(src.replyTo, 200)) ? str(src.replyTo, 200) : '',
      language: writingLanguage.isSupported(src.language) ? src.language : '',
      autoSend: src.autoSend === true,
    };
  },
  steps: {
    async draft({ sb, autopilot, job, deps }) {
      if (!autopilot) throw fault('This job has no autopilot settings.', 'permanent');
      if (!process.env.ANTHROPIC_API_KEY) throw fault('ANTHROPIC_API_KEY is not configured.', 'not_configured');
      const s = pat.cleanSettings(autopilot.settings);
      if (!s.audienceTags.length) {
        return { wait: 'permission', resume: 'draft', event: { title: 'Pat needs to know who the campaign is for', body: 'Add the audience tags (the contacts it goes to) in Pat\'s autopilot settings and it carries on.', action: { type: 'settings', agent: 'pat' } } };
      }
      const r = await sb('GET', `/seo_runs?${autopilot.intel_profile_id ? `intel_profile_id=eq.${autopilot.intel_profile_id}` : `user_id=eq.${autopilot.user_id}`}&select=business_summary,products_services&order=created_at.desc&limit=1`);
      const run = r.ok && r.data && r.data[0];
      const businessContext = run ? [run.business_summary, (run.products_services || []).join(', ')].filter(Boolean).join('\n') : '';
      const built = await (deps.buildCampaign || buildCampaign)({ offer: s.offer, ctaUrl: s.ctaUrl, audience: s.audience || s.audienceTags.join(', '), senderName: s.senderName, senderTitle: s.senderTitle, companyName: s.companyName, businessContext, language: s.language, campaignName: `Autopilot ${new Date().toISOString().slice(0, 10)}`, replyTo: s.replyTo });
      if (built.status === 'needs_input') {
        return { wait: 'permission', resume: 'draft', event: { title: 'Pat needs a few details before writing', body: `${(built.questions || []).map(q => `• ${typeof q === 'string' ? q : q.question || q.label || ''}`).join('\n')}\n\nAdd them in Pat's autopilot settings and Pat carries on.`, action: { type: 'settings', agent: 'pat' } } };
      }
      const ins = await sb('POST', '/mission_artifacts', {
        user_id: autopilot.user_id, intel_profile_id: autopilot.intel_profile_id || null, mission_id: null,
        agent_key: 'delivery', kind: 'pat_campaign', title: `Email campaign — ${str(built.subject, 90)}`,
        payload: { params: { offer: s.offer, ctaUrl: s.ctaUrl, audience: s.audience, senderName: s.senderName, senderTitle: s.senderTitle, companyName: s.companyName, replyTo: s.replyTo, language: s.language, audienceTags: s.audienceTags, projectId: autopilot.project_id || null }, subject: built.subject, html: built.html, text: built.text, review: built.review, fixed: built.fixed, questions: built.questions, autopilot: true, autopilotJobId: job.id, autoSend: s.autoSend },
        status: 'pending_approval',
      });
      if (!ins.ok || !ins.data || !ins.data[0]) throw fault(`Could not save the campaign (HTTP ${ins.status}).`, ins.status === 404 ? 'not_configured' : 'transient', { status: ins.status });
      const art = ins.data[0];
      const ok = built.review && built.review.approved;
      return {
        wait: 'approval', resume: 'send', state: { artifactId: art.id },
        event: {
          title: `Ready for your OK: ${art.title}`,
          body: `${ok ? 'It passed Pat\'s review.' : `Pat's review found problems it couldn't fix, so it can't be approved as is:\n• ${((built.review && built.review.blockers) || []).slice(0, 5).join('\n• ')}`}\n\nGoes to: contacts tagged ${s.audienceTags.join(' + ')}.\n${s.autoSend ? 'Approving sends it (in batches, within your daily limit, skipping anyone who unsubscribed).' : 'Approving gets it ready; you press send on Pat\'s page.'}`,
          action: { type: 'artifact', artifactId: art.id, kind: 'pat_campaign' },
        },
      };
    },

    async send({ state, sb, autopilot, job, deps, now }) {
      const a = await sb('GET', `/mission_artifacts?id=eq.${state.artifactId}&select=*&limit=1`);
      const art = a.ok && a.data && a.data[0];
      if (!art || art.status !== 'approved') throw fault('The campaign wasn\'t approved.', 'permanent');
      const p = art.payload || {};
      if (!p.autoSend) return { done: { approved: true, sent: 0 }, event: { kind: 'info', title: `Approved: ${art.title}`, body: 'It\'s ready to send from Pat\'s page whenever you are.', action: { type: 'link', href: '/agents/email-delivery-agent.html' } } };
      const tags = (p.params && p.params.audienceTags) || [];
      const scope = autopilot.intel_profile_id ? `intel_profile_id=eq.${autopilot.intel_profile_id}` : `user_id=eq.${autopilot.user_id}`;
      const sendCore = deps.sendCore || require('../../send-campaign.js').core;
      let cursor = state.cursor || null, sent = state.sent || 0, skipped = state.skipped || 0, handled = 0;
      const sentBefore = sent;
      while (handled < PER_STEP) {
        const q = await sb('GET', `/contacts?${scope}&status=eq.subscribed&tags=ov.{${tags.map(t => `"${t.replace(/"/g, '')}"`).join(',')}}${cursor ? `&id=gt.${cursor}` : ''}&select=id,email,first_name,last_name,company,custom_fields&order=id.asc&limit=${BATCH}`);
        if (!q.ok) throw fault(`Could not read the contacts (HTTP ${q.status}).`, 'transient', { status: q.status });
        const batch = q.data || [];
        if (!batch.length) break;
        const out = await invokeSend(sendCore, { subject: p.subject, html: p.html, text: p.text, replyTo: p.params.replyTo || undefined, campaignId: `autopilot_${job.id}`, companyName: p.params.companyName, recipients: batch.map(c => ({ to: c.email, toName: [c.first_name, c.last_name].filter(Boolean).join(' '), mergeFields: buildMergeFields(c, null) })) }, autopilot.user_id);
        const progress = { cursor, sent, skipped };
        if (out.code === 429) throw fault(out.body && out.body.error || 'Daily send limit reached.', 'rate_limited', { retryAfterMs: tomorrowMs(now()), stateUpdate: progress, progressed: sent > sentBefore });
        if (out.code >= 500) throw fault(`Sending failed: ${(out.body && out.body.error) || out.code}`, 'transient', { status: out.code, stateUpdate: progress });
        if (out.code >= 400) throw fault(`Pat's send checks refused it: ${(out.body && out.body.error) || out.code}`, 'permanent', { stateUpdate: progress });
        const budgetSkipped = ((out.body && out.body.rejected) || []).filter(r => /Daily send limit/i.test(r.error || ''));
        // Recipients cut by the daily limit go first tomorrow: the cursor stops before them.
        const done = budgetSkipped.length ? batch.filter(c => !budgetSkipped.some(r => r.to === c.email)) : batch;
        sent += (out.body && out.body.sent) || 0;
        skipped += ((out.body && out.body.suppressed) || 0);
        if (budgetSkipped.length) {
          const lastDone = done.length ? done[done.length - 1].id : cursor;
          const first = batch.findIndex(c => budgetSkipped.some(r => r.to === c.email));
          cursor = first > 0 ? batch[first - 1].id : (first === 0 ? cursor : lastDone);
          await sb('PATCH', `/agent_jobs?id=eq.${job.id}`, { state: { ...state, cursor, sent, skipped } });
          throw fault('Daily send limit reached; the rest go tomorrow.', 'rate_limited', { retryAfterMs: tomorrowMs(now()), stateUpdate: { cursor, sent, skipped }, progressed: sent > sentBefore });
        }
        cursor = batch[batch.length - 1].id;
        handled += batch.length;
        await sb('PATCH', `/agent_jobs?id=eq.${job.id}`, { state: { ...state, cursor, sent, skipped } });
        if (batch.length < BATCH) { handled = Infinity; break; }
      }
      if (handled !== Infinity && handled >= PER_STEP) return { next: 'send', state: { cursor, sent, skipped } };
      return { done: { sent, skipped }, state: { cursor, sent, skipped }, event: { kind: 'done', title: `Sent: ${art.title}`, body: `${sent} email${sent === 1 ? '' : 's'} sent to contacts tagged ${tags.join(' + ')}${skipped ? `; ${skipped} skipped (unsubscribed or undeliverable)` : ''}.`, action: { type: 'link', href: '/agents/email-delivery-agent.html' } } };
    },
  },
  stepLabel: (s) => ({ draft: 'writing the campaign', send: 'sending the campaign' }[s] || s),
};

module.exports = pat;
