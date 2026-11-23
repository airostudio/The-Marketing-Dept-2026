/**
 * api/_lib/autopilot/drafts.js — agents that do the work on a schedule and
 * hand the business a finished piece to approve:
 *
 *   analytics  Analytics Brain: a report on the business's real marketing
 *              numbers (skipped, and said so, when there is nothing to report)
 *   cro        CRO Lab: reads the business's site and proposes A/B tests
 *              against its conversion goal
 *   social     Social Studio: drafts the next batch of posts, rotating
 *              through the business's topics
 *
 * Each runs on the same engine as SEO Autopilot (schedule, self-repair,
 * "What happened"), and each ends as a mission artifact waiting for approval.
 * Approving it does what approving that artifact always does (the report is
 * kept, tests go into the CRO backlog, posts go into the Content Calendar).
 * Nothing is sent or posted from here: those steps need the business's OK,
 * and posting to social networks needs their sign-in, which Audema doesn't
 * hold yet.
 */

'use strict';

const writingLanguage = require('../writing-language.js');
const { gatherFacts, PERIODS } = require('../analytics-facts.js');
const { buildReport } = require('../analytics-report.js');
const { crawlSite } = require('../nancy-crawl.js');
const { auditAndPropose } = require('../cro-audit.js');
const { generateSocialPosts } = require('../social-posts-gen.js');
const { callClaudeForJSON } = require('../nancy-claude.js');

const str = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
const list = (v, n, each) => (Array.isArray(v) ? v : String(v || '').split(/\n|,/)).map(x => str(x, each)).filter(Boolean).slice(0, n);
const scopeFilter = (ap) => (ap.intel_profile_id ? `intel_profile_id=eq.${ap.intel_profile_id}` : ap.project_id ? `project_id=eq.${ap.project_id}` : `user_id=eq.${ap.user_id}`);
const SOCIAL_PLATFORMS = ['LinkedIn', 'Twitter/X', 'Facebook'];
const SOCIAL_GOALS = ['Thought Leadership', 'Product Launch', 'Case Study', 'Engagement', 'Community Building'];

function fault(message, kind, status) { const e = new Error(message); e.kind = kind; if (status) e.status = status; return e; }
function needKey() { if (!process.env.ANTHROPIC_API_KEY) throw fault('ANTHROPIC_API_KEY is not configured.', 'not_configured'); }

/** What the business is, from its latest website read (SEO profile), for framing only. */
async function businessContext(sb, ap) {
  const r = await sb('GET', `/seo_runs?${scopeFilter(ap)}&status=eq.ready&select=website_url,business_summary,products_services,target_customer&order=created_at.desc&limit=1`);
  const run = r.ok && r.data && r.data[0];
  if (!run) return { text: '', siteUrl: null };
  const text = [
    run.business_summary && `About: ${run.business_summary}`,
    (run.products_services || []).length && `Sells: ${run.products_services.slice(0, 10).join(', ')}`,
    run.target_customer && `Customers: ${run.target_customer}`,
  ].filter(Boolean).join('\n');
  return { text, siteUrl: run.website_url || null };
}

async function saveArtifact(sb, ap, row) {
  const ins = await sb('POST', '/mission_artifacts', { user_id: ap.user_id, intel_profile_id: ap.intel_profile_id || null, mission_id: null, ...row });
  if (!ins.ok || !ins.data || !ins.data[0]) throw fault(ins.status === 404 ? 'Mission artifacts are not installed (run supabase-mission-artifacts.sql).' : `Could not save the result (HTTP ${ins.status}).`, ins.status === 404 ? 'not_configured' : null, ins.status);
  return ins.data[0];
}

function readyEvent(label, artifact, body) {
  return { kind: 'needs_approval', title: `Ready for your OK: ${artifact.title}`, body, action: { type: 'artifact', artifactId: artifact.id, kind: artifact.kind } };
}

function noAutopilot() { return fault('This job has no autopilot settings.', 'permanent'); }

/* ── Analytics Brain ─────────────────────────────────────────────────── */
const analytics = {
  agent: 'analytics', kind: 'analytics_report', firstStep: 'report', label: 'Analytics Brain', approvalOnly: true,
  cleanSettings(s) {
    const src = (s && typeof s === 'object') ? s : {};
    return { periodDays: PERIODS.includes(Number(src.periodDays)) ? Number(src.periodDays) : 7, focus: str(src.focus, 300), language: writingLanguage.isSupported(src.language) ? src.language : '' };
  },
  steps: {
    async report({ sb, autopilot, deps }) {
      if (!autopilot) throw noAutopilot();
      needKey();
      const s = analytics.cleanSettings(autopilot.settings);
      const facts = await (deps.gatherFacts || gatherFacts)(sb, { supabaseUrl: process.env.SUPABASE_URL, serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY, userId: autopilot.user_id, periodDays: s.periodDays });
      const anyData = (facts.email && facts.email.available && facts.email.campaignsSent > 0) || (facts.audience && facts.audience.available && facts.audience.totalContacts > 0)
        || (facts.social && facts.social.available && (facts.social.postsCreated > 0 || facts.social.published > 0)) || (facts.flows && facts.flows.available && facts.flows.count > 0)
        || (facts.revenue && facts.revenue.available && facts.revenue.orders > 0);
      if (!anyData) {
        return { done: { skipped: 'no_data' }, event: { kind: 'info', title: `No report this time: nothing happened in ${facts.period ? facts.period.label : 'the period'}`, body: 'There were no emails sent, posts, flows, orders or contacts on record, so Analytics Brain skipped the report rather than write one about nothing.' } };
      }
      const ctx = await businessContext(sb, autopilot);
      const built = await (deps.buildReport || buildReport)(facts, { focus: s.focus, language: s.language, businessContext: ctx.text });
      const artifact = await saveArtifact(sb, autopilot, {
        agent_key: 'analytics', kind: 'analytics_report', title: built.title,
        payload: { params: { periodDays: s.periodDays, focus: s.focus, language: s.language, projectId: autopilot.project_id || null }, facts, markdown: built.markdown, review: built.review, autopilot: true },
        status: 'pending_approval',
      });
      const checked = built.review && built.review.approved ? 'Every number in it was checked against your data.' : 'Some numbers could not be matched to your data, so it can\'t be approved as is. Read it before deciding.';
      return { done: { artifactId: artifact.id }, event: readyEvent('Analytics Brain', artifact, `Your ${facts.period ? facts.period.label : ''} marketing report is written. ${checked}`) };
    },
  },
};

/* ── CRO Lab ─────────────────────────────────────────────────────────── */
const cro = {
  agent: 'cro', kind: 'cro_plan', firstStep: 'audit', label: 'CRO Lab', approvalOnly: true,
  cleanSettings(s) {
    const src = (s && typeof s === 'object') ? s : {};
    return { goal: str(src.goal, 160), urls: list(src.urls, 2, 300).filter(u => /^https?:\/\//i.test(u)), language: writingLanguage.isSupported(src.language) ? src.language : '' };
  },
  steps: {
    async audit({ sb, autopilot, deps }) {
      if (!autopilot) throw noAutopilot();
      needKey();
      const s = cro.cleanSettings(autopilot.settings);
      const ctx = await businessContext(sb, autopilot);
      const urls = s.urls.length ? s.urls : (ctx.siteUrl ? [ctx.siteUrl] : []);
      if (!s.goal || !urls.length) {
        return { wait: 'permission', resume: 'audit', event: { title: 'CRO Lab needs your goal and page', body: `${!s.goal ? 'What counts as a conversion (a booking, a call, a sale…)? ' : ''}${!urls.length ? 'Which page should it test? ' : ''}Add ${!s.goal && !urls.length ? 'them' : 'it'} in the Autopilot settings and it carries on.`, action: { type: 'settings', agent: 'cro' } } };
      }
      const ex = await sb('GET', `/experiments?user_id=eq.${autopilot.user_id}&status=in.(draft,active,paused)&select=name&limit=30`);
      const existing = ex.ok ? (ex.data || []).map(e => str(e.name, 80)).filter(Boolean) : [];
      const sites = [], unreadable = [];
      for (const url of urls) {
        try { const c = await (deps.crawlSite || crawlSite)(url); sites.push({ url, html: c.homepageHtml || '', pages: (c.pages || []).slice(0, 3) }); }
        catch (e) { unreadable.push({ url, error: e.message }); }
      }
      if (!sites.length) throw fault(`None of the pages could be read: ${unreadable.map(u => `${u.url} — ${u.error}`).join('; ')}`, 'site_unreachable');
      const result = await (deps.auditAndPropose || auditAndPropose)(sites, { goal: s.goal, existing, language: s.language, businessContext: ctx.text });
      const host = sites.map(x => { try { return new URL(x.url).hostname.replace(/^www\./, ''); } catch { return x.url; } }).join(', ').slice(0, 80);
      if (!result.ideas.length) {
        return { done: { skipped: 'no_ideas' }, event: { kind: 'info', title: `CRO Lab found no new test worth running on ${host}`, body: `Nothing it could back up with what's on the page${existing.length ? `, and ${existing.length} test${existing.length === 1 ? ' is' : 's are'} already planned or running` : ''}. It looks again next time.` } };
      }
      const artifact = await saveArtifact(sb, autopilot, {
        agent_key: 'cro', kind: 'cro_plan', title: `CRO plan — ${host}`,
        payload: { params: { urls, goal: s.goal, language: s.language, projectId: autopilot.project_id || null }, ideas: result.ideas, observations: result.observations, unreadable, alreadyTesting: existing, droppedUnverified: result.droppedUnverified, droppedForeignFigures: result.droppedForeignFigures, autopilot: true },
        status: 'pending_approval',
      });
      return { done: { artifactId: artifact.id }, event: readyEvent('CRO Lab', artifact, `${result.ideas.length} test${result.ideas.length === 1 ? '' : 's'} proposed for "${s.goal}" on ${host}. Approving puts them in your CRO backlog; nothing on your site changes.`) };
    },
  },
};

/* ── Social Studio ───────────────────────────────────────────────────── */
const social = {
  agent: 'social', kind: 'social_posts', firstStep: 'draft', label: 'Social Studio', approvalOnly: true,
  cleanSettings(s) {
    const src = (s && typeof s === 'object') ? s : {};
    const platforms = [...new Set((Array.isArray(src.platforms) ? src.platforms : []).filter(p => SOCIAL_PLATFORMS.includes(p)))];
    return {
      topics: list(src.topics, 20, 200), platforms: platforms.length ? platforms : ['LinkedIn'],
      contentGoal: SOCIAL_GOALS.includes(src.contentGoal) ? src.contentGoal : 'Engagement',
      postCount: Math.max(1, Math.min(10, parseInt(src.postCount, 10) || 5)),
      // On approval: queue the posts one a day at this hour (published through the business's own signed-in accounts).
      autoSchedule: src.autoSchedule !== false,
      postHour: Number.isInteger(Number(src.postHour)) ? Math.max(0, Math.min(23, Number(src.postHour))) : 10,
      language: writingLanguage.isSupported(src.language) ? src.language : '',
    };
  },
  steps: {
    async draft({ sb, autopilot, job, deps }) {
      if (!autopilot) throw noAutopilot();
      needKey();
      const s = social.cleanSettings(autopilot.settings);
      const ctx = await businessContext(sb, autopilot);
      let topics = s.topics;
      if (!topics.length) {
        const r = await sb('GET', `/seo_runs?${scopeFilter(autopilot)}&status=eq.ready&select=products_services&order=created_at.desc&limit=1`);
        topics = ((r.ok && r.data && r.data[0] && r.data[0].products_services) || []).map(x => str(x, 200)).filter(Boolean);
      }
      if (!topics.length) {
        return { wait: 'permission', resume: 'draft', event: { title: 'Social Studio needs to know what to post about', body: 'Add a few topics in the Autopilot settings (or let SEO Autopilot read your website first) and it carries on.', action: { type: 'settings', agent: 'social' } } };
      }
      // Rotate through the topics, one per run.
      const done = await sb('GET', `/agent_jobs?autopilot_id=eq.${autopilot.id}&status=eq.done&select=id&limit=500`);
      const topic = topics[((done.ok && done.data) || []).length % topics.length];
      const businessText = [ctx.text, writingLanguage.directive(s.language)].filter(Boolean).join('\n\n');
      const gen = await (deps.generateSocialPosts || generateSocialPosts)({ apiKey: process.env.ANTHROPIC_API_KEY, platforms: s.platforms, contentGoal: s.contentGoal, topic, frequency: '3x per week', postCount: s.postCount, businessContext: businessText });
      const { cleanPosts } = require('../../mission-social.js');
      const posts = cleanPosts(gen.posts, s.platforms);
      if (!posts.length) throw fault('The posts came back empty.', 'model');
      const artifact = await saveArtifact(sb, autopilot, {
        agent_key: 'social', kind: 'social_posts', title: `Social posts — ${topic.slice(0, 80)}`,
        payload: { params: { topic, contentGoal: s.contentGoal, platforms: s.platforms, postCount: s.postCount, language: s.language, projectId: autopilot.project_id || null }, contentPlanNote: str(gen.contentPlanNote, 800), posts, autopilot: true, autoSchedule: s.autoSchedule ? { hour: s.postHour, timezone: (autopilot.cadence && autopilot.cadence.timezone) || 'UTC' } : null },
        status: 'pending_approval',
      });
      const ready = posts.filter(p => !p.problem).length;
      return { done: { artifactId: artifact.id, topic }, event: readyEvent('Social Studio', artifact, `${posts.length} post${posts.length === 1 ? '' : 's'} about "${topic}" for ${s.platforms.join(', ')}${ready < posts.length ? ` (${posts.length - ready} need${posts.length - ready === 1 ? 's' : ''} a fix before they can go out)` : ''}. ${s.autoSchedule ? `Approving schedules them one a day at ${String(s.postHour).padStart(2, '0')}:00, posted through your own signed-in accounts (Connections).` : 'Approving puts them in your Content Calendar ready to schedule; nothing is posted.'}`) };
    },
  },
};

/* ── Deck Maker: the monthly marketing review ────────────────────────── */
const DECK_TYPES = ['COVER', 'METRICS', 'CHANNELS', 'INSIGHT', 'EVIDENCE', 'STRATEGY', 'NEXT_QUARTER', 'TIMELINE', 'CUSTOM'];
const DECK_TOOL = {
  name: 'submit_deck',
  description: 'A short marketing review deck built only from the facts given.',
  input_schema: { type: 'object', properties: { slides: { type: 'array', items: { type: 'object', properties: {
    title: { type: 'string' }, type: { type: 'string', enum: DECK_TYPES },
    bullets: { type: 'array', items: { type: 'string' }, description: '2-5 short bullets. Every number must come from the facts, exactly.' },
    speaker_notes: { type: 'string' }, so_what: { type: 'string' },
  }, required: ['title', 'type', 'bullets'] } } }, required: ['slides'] },
};
/** Every figure in a line must appear in the facts; otherwise the line is dropped. */
function backedByFacts(line, factsText) { return (String(line).match(/\d[\d,.]*%?/g) || []).every(n => factsText.includes(n.replace(/,/g, '').replace(/%$/, '').replace(/\.0+$/, ''))); }

const deck = {
  agent: 'deck', kind: 'deck_outline', firstStep: 'outline', label: 'Deck Maker', approvalOnly: true,
  cleanSettings(s) {
    const src = (s && typeof s === 'object') ? s : {};
    return { periodDays: PERIODS.includes(Number(src.periodDays)) ? Number(src.periodDays) : 30, audience: str(src.audience, 120) || 'the team', language: writingLanguage.isSupported(src.language) ? src.language : '' };
  },
  steps: {
    async outline({ sb, autopilot, deps }) {
      if (!autopilot) throw noAutopilot();
      needKey();
      const s = deck.cleanSettings(autopilot.settings);
      const facts = await (deps.gatherFacts || gatherFacts)(sb, { supabaseUrl: process.env.SUPABASE_URL, serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY, userId: autopilot.user_id, periodDays: s.periodDays });
      const anyData = (facts.email && facts.email.campaignsSent > 0) || (facts.audience && facts.audience.totalContacts > 0) || (facts.social && (facts.social.postsCreated > 0 || facts.social.published > 0)) || (facts.revenue && facts.revenue.orders > 0);
      if (!anyData) return { done: { skipped: 'no_data' }, event: { kind: 'info', title: 'No review deck this time: nothing to report', body: 'There was no marketing activity on record for the period, so Deck Maker skipped the review deck rather than fill it with guesses.' } };
      const ctx = await businessContext(sb, autopilot);
      const factsText = JSON.stringify(facts);
      const r = await (deps.callClaude || callClaudeForJSON)({
        system: `You build a short marketing review deck (6-9 slides) for ${s.audience}. Use ONLY the facts given: every number must appear in them exactly; never estimate, round differently, or add a benchmark. Where a channel has no data, say so plainly instead of filling it. ${writingLanguage.directive(s.language) || ''}`,
        user: `Business:\n${ctx.text || 'unknown'}\n\nFacts (${facts.period ? facts.period.label : ''}):\n${factsText.slice(0, 12000)}`,
        tool: DECK_TOOL, maxTokens: 4000,
      });
      if (!r.success) throw fault(`Deck Maker couldn't write the deck: ${r.error}`, /took too long|overloaded|5\d\d/i.test(r.error) ? 'transient' : 'model');
      let dropped = 0;
      const slides = (r.data.slides || []).map(sl => {
        const bullets = (sl.bullets || []).map(b => str(b, 200)).filter(b => { const ok = backedByFacts(b, factsText); if (!ok) dropped++; return ok; });
        return { ...sl, title: str(sl.title, 90), type: DECK_TYPES.includes(sl.type) ? sl.type : 'CUSTOM', bullets };
      }).filter(sl => sl.bullets.length || sl.type === 'COVER');
      if (slides.length < 3) throw fault('The deck came back with too few slides backed by your numbers.', 'model');
      const markdown = slides.map((sl, i) => [`**Slide ${i + 1}: ${sl.title}**`, `[TYPE: ${sl.type}]`, ...sl.bullets.map(b => `- ${b}`), sl.speaker_notes ? `Speaker Notes: ${str(sl.speaker_notes, 400)}` : '', sl.so_what ? `So What: ${str(sl.so_what, 160)}` : ''].filter(Boolean).join('\n')).join('\n\n');
      const company = (ctx.text.match(/^About: (.{1,60})/) || [])[1] || 'Marketing review';
      const artifact = await saveArtifact(sb, autopilot, {
        agent_key: 'deck', kind: 'deck_outline', title: `Marketing review deck — ${facts.period ? facts.period.label : ''}`.trim(),
        payload: { params: { periodDays: s.periodDays, audience: s.audience, projectId: autopilot.project_id || null }, markdown, slides, facts, dropped, company: str(company, 60), deckType: 'Marketing review', audience: s.audience, autopilot: true },
        status: 'pending_approval',
      });
      return { done: { artifactId: artifact.id }, event: readyEvent('Deck Maker', artifact, `${slides.length} slides for ${s.audience}, built only from your real numbers${dropped ? ` (${dropped} line${dropped === 1 ? '' : 's'} with a figure not in your data ${dropped === 1 ? 'was' : 'were'} removed)` : ''}. Open it in Deck Maker to download the PowerPoint.`) };
    },
  },
};

for (const h of [analytics, cro, social, deck]) h.stepLabel = () => ({ analytics: 'writing the report', cro: 'auditing your pages', social: 'drafting the posts', deck: 'writing the deck' }[h.agent]);

module.exports = { analytics, cro, social, deck, businessContext, backedByFacts };
