/**
 * api/mission-social.js — run Social Studio's post writer for real, as a step
 * of a Scotty mission.
 *
 * POST { action: 'generate', topic, contentGoal?, platforms?, postCount?, frequency?,
 *        businessContext?, language?, competitors?, projectId?, intelProfileId?, missionId? }
 *   Writes a batch of platform-native posts (api/_lib/social-posts-gen.js, the
 *   same generator Social Studio uses) and saves them as a mission_artifacts
 *   row (kind 'social_posts', status 'pending_approval'). A missing topic is a
 *   question back before any model call.
 * Header: Authorization: Bearer <the caller's own Supabase access token>
 *
 * Text posts only, on the platforms that can be published without a picture:
 * LinkedIn, X and Facebook. (Instagram and TikTok need artwork — that is
 * Nancy's job.) Nothing is scheduled or published from here; approving the
 * artifact (api/mission-artifacts.js) puts the posts in the Content Calendar
 * as approved, ready to schedule.
 *
 * Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY.
 */

'use strict';

const { sbRest, isUuid } = require('./_lib/supabase-rest.js');
const { withFailureReporting } = require('./_lib/report-failure.js');
const { rateLimited } = require('./_lib/rate-limit.js');
const { canAccessRecord } = require('./_lib/profile-access.js');
const { generateSocialPosts } = require('./_lib/social-posts-gen.js');
const writingLanguage = require('./_lib/writing-language.js');

const ALLOWED_PLATFORMS = ['LinkedIn', 'Twitter/X', 'Facebook'];
const GOALS = ['Thought Leadership', 'Product Launch', 'Case Study', 'Engagement', 'Community Building'];
const MAX_POSTS = 10;
const DEFAULT_POSTS = 6;
// What each platform's publisher can actually post as one update.
const LIMITS = { 'Twitter/X': 280, 'LinkedIn': 3000, 'Facebook': 63000 };

async function getCallerFromToken(supabaseUrl, serviceKey, accessToken) {
  const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return null;
  return res.json();
}

const str = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);

/** What would stop this post being published as written, in plain words ('' if nothing). */
function postProblem(platform, text, hashtags) {
  const composed = text + (hashtags.length ? '\n\n' + hashtags.map(h => '#' + h).join(' ') : '');
  const limit = LIMITS[platform];
  if (limit && composed.length > limit) {
    return platform === 'Twitter/X'
      ? `${composed.length} characters — over X's ${limit} limit, and a thread cannot be posted automatically.`
      : `${composed.length} characters — over ${platform}'s ${limit} limit.`;
  }
  return '';
}

/** Shape and bound the generator's posts; drop any on a platform not asked for. */
function cleanPosts(posts, platforms) {
  const out = [];
  for (const p of Array.isArray(posts) ? posts : []) {
    if (!p || !platforms.includes(p.platform)) continue;
    const body = String(p.body || '').replace(/\r\n?/g, '\n').trim().slice(0, 4000);
    if (!body) continue;
    const hashtags = (Array.isArray(p.hashtags) ? p.hashtags : []).map(h => str(h, 60).replace(/\s+/g, '').replace(/^#+/, '')).filter(Boolean).slice(0, 10);
    out.push({
      platform: p.platform, title: str(p.title, 120), hook: str(p.hook, 300), body, hashtags,
      recommendedFormat: str(p.recommendedFormat, 80), postingTime: str(p.postingTime, 200), engagementNote: str(p.engagementNote, 300),
      problem: postProblem(p.platform, body, hashtags),
    });
  }
  return out;
}

module.exports = withFailureReporting('api/mission-social', async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return res.status(500).json({ error: 'SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not configured.' });

  const accessToken = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
  if (!accessToken) return res.status(401).json({ error: 'Missing Authorization header.' });
  const caller = await getCallerFromToken(supabaseUrl, serviceKey, accessToken);
  if (!caller?.id) return res.status(401).json({ error: 'Invalid or expired session.' });

  // Each call is a paid model generation.
  if (rateLimited(req, res, { name: 'mission-social', max: 6, windowMs: 60 * 1000, auth: { userId: caller.id } })) return;

  const body = req.body || {};
  if (body.action !== 'generate') return res.status(400).json({ error: `Unknown action "${body.action}". Use 'generate'.` });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: 'ANTHROPIC_API_KEY is not configured, so Social Studio cannot write posts.' });

  const topic = str(body.topic, 400);
  if (!topic) return res.status(400).json({ error: 'What should the posts be about? The topic is required.', field: 'topic' });
  const platforms = [...new Set((Array.isArray(body.platforms) ? body.platforms : []).filter(p => ALLOWED_PLATFORMS.includes(p)))];
  const useP = platforms.length ? platforms : ['LinkedIn'];
  const contentGoal = GOALS.includes(body.contentGoal) ? body.contentGoal : 'Engagement';
  const postCount = Math.max(1, Math.min(MAX_POSTS, parseInt(body.postCount, 10) || DEFAULT_POSTS));

  const sb = (m, p, b) => sbRest(supabaseUrl, serviceKey, m, p, b);

  let intelProfileId = null;
  if (body.intelProfileId) {
    if (!isUuid(body.intelProfileId)) return res.status(400).json({ error: 'intelProfileId is not a valid id.' });
    const allowed = await canAccessRecord(supabaseUrl, serviceKey, caller.id,
      { user_id: null, intel_profile_id: body.intelProfileId }, { requireEdit: true });
    if (!allowed) return res.status(403).json({ error: 'You do not have edit access to that business profile.' });
    intelProfileId = body.intelProfileId;
  }
  let projectId = null;
  if (body.projectId) {
    if (!isUuid(body.projectId)) return res.status(400).json({ error: 'projectId is not a valid id.' });
    const pr = await sb('GET', `/projects?id=eq.${body.projectId}&user_id=eq.${caller.id}&select=id&limit=1`);
    if (pr.ok && pr.data && pr.data[0]) projectId = pr.data[0].id;
  }
  // The Content Calendar only shows posts for the active profile or project.
  if (!intelProfileId && !projectId) {
    return res.status(409).json({ error: 'No business profile or project is selected, so the Content Calendar would have nowhere to show these posts. Pick one first.', code: 'no_scope' });
  }

  const language = writingLanguage.isSupported(body.language) ? body.language : '';
  const businessContext = [String(body.businessContext || '').slice(0, 20000), writingLanguage.directive(language)].filter(Boolean).join('\n\n');

  let gen;
  try {
    gen = await generateSocialPosts({
      apiKey: process.env.ANTHROPIC_API_KEY, platforms: useP, contentGoal, topic,
      frequency: str(body.frequency, 60) || '3x per week', postCount, businessContext,
      competitors: str(body.competitors, 300),
    });
  } catch (e) {
    return res.status(e.status && e.status < 600 ? e.status : 502).json({ error: `Social Studio could not write the posts: ${e.message}` });
  }

  const posts = cleanPosts(gen.posts, useP);
  if (!posts.length) return res.status(502).json({ error: 'The model returned no usable posts. Try again — this is usually transient.' });

  const created = await sb('POST', '/mission_artifacts', {
    user_id: caller.id, intel_profile_id: intelProfileId,
    mission_id: body.missionId ? String(body.missionId).slice(0, 80) : null,
    agent_key: 'social', kind: 'social_posts',
    title: `Social posts — ${topic.slice(0, 80)}`,
    payload: { params: { topic, contentGoal, platforms: useP, postCount, language, projectId }, contentPlanNote: str(gen.contentPlanNote, 800), posts },
    status: 'pending_approval',
  });
  if (!created.ok) {
    return res.status(created.status === 404 ? 503 : 500).json(created.status === 404
      ? { code: 'not_installed', error: 'Mission artifacts are not installed. Run supabase-mission-artifacts.sql in the Supabase SQL editor.' }
      : { code: 'db_error', error: `Database error (HTTP ${created.status}).` });
  }
  const artifact = created.data && created.data[0];
  return res.json({
    ok: true, artifactId: artifact.id, status: artifact.status,
    contentPlanNote: artifact.payload.contentPlanNote, posts, postable: posts.filter(p => !p.problem).length,
  });
});

module.exports.cleanPosts = cleanPosts;
module.exports.postProblem = postProblem;
