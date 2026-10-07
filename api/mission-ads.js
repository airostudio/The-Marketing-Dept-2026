/**
 * api/mission-ads.js — keep the Ad Creative Lab's campaign as a Scotty mission
 * artifact.
 *
 * Ad copy is written platform by platform (api/generate-ads.js, one slow call
 * each, driven from the browser by web/js/ads-mission.js — the same way the Ad
 * Creative Lab page does it). This endpoint is where the finished campaign is
 * checked and kept:
 *
 * POST { action: 'save', product, audience, objective?, platforms, strategyNote?, variants,
 *        failures?, language?, projectId?, intelProfileId?, missionId? }
 *   Checks every ad against its platform's real copy limits (api/_lib/ad-specs.js)
 *   and saves the campaign as a mission_artifacts row (kind 'ad_campaign',
 *   status 'pending_approval'). An ad that does not fit its platform is flagged
 *   with the exact limit it breaks and is left out on approval — the platform
 *   would reject or cut it.
 * Header: Authorization: Bearer <the caller's own Supabase access token>
 *
 * Nothing is bought or published: there is no ad-platform account behind this.
 * Approving the campaign (api/mission-artifacts.js) saves the fitting ads as
 * approved AD COPY in the library on the Content Calendar page — kept apart
 * from organic posts, which the calendar can schedule — for the person to
 * paste into their ad manager.
 *
 * Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 */

'use strict';

const { sbRest, isUuid } = require('./_lib/supabase-rest.js');
const { withFailureReporting } = require('./_lib/report-failure.js');
const { rateLimited } = require('./_lib/rate-limit.js');
const { canAccessRecord } = require('./_lib/profile-access.js');
const { PLATFORM_SPECS } = require('./_lib/ad-specs.js');
const writingLanguage = require('./_lib/writing-language.js');

const OBJECTIVES = ['Awareness', 'Traffic', 'Leads', 'Conversions', 'Retargeting'];
const MAX_VARIANTS = 40;

async function getCallerFromToken(supabaseUrl, serviceKey, accessToken) {
  const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return null;
  return res.json();
}

const str = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);

/**
 * What stops an ad being used as written (`problems`) and what is worth a
 * look (`warnings`). Lengths are checked against the platform's own limits;
 * a field the platform doesn't have is not checked.
 */
function checkVariant(v) {
  const spec = PLATFORM_SPECS[v.platform] || {};
  const problems = [], warnings = [];
  const over = (field, label, text, max) => { if (max && text.length > max) problems.push(`${label} is ${text.length} characters — ${v.platform} allows ${max}.`); };
  over('headline', 'Headline', v.headline, spec.headline && spec.headline.max);
  over('body', 'The main text', v.body, spec.body && spec.body.max);
  const descMax = (spec.description && spec.description.max) || (spec.long_headline && spec.long_headline.max);
  over('description', 'The description', v.description || '', descMax);
  if (!v.headline && spec.headline) problems.push('There is no headline.');
  if (spec.cta_options && v.cta && !spec.cta_options.includes(v.cta)) {
    warnings.push(`"${v.cta}" is not one of ${v.platform}'s call-to-action buttons (${spec.cta_options.join(', ')}).`);
  }
  return { problems, warnings };
}

/** Bound the ads the client collected; drop any on a platform that wasn't asked for. */
function cleanVariants(variants, platforms) {
  const out = [];
  for (const v of Array.isArray(variants) ? variants : []) {
    if (!v || !platforms.includes(v.platform) || !PLATFORM_SPECS[v.platform]) continue;
    const c = {
      platform: v.platform, framework: str(v.framework, 40), angleName: str(v.angleName, 120),
      psychologicalTrigger: str(v.psychologicalTrigger, 160),
      headline: str(v.headline, 200), body: String(v.body || '').replace(/\r\n?/g, '\n').trim().slice(0, 1500),
      description: str(v.description, 200), cta: str(v.cta, 40),
      visualDirection: str(v.visualDirection, 600), abHypothesis: str(v.abHypothesis, 400),
    };
    if (!c.body && !c.headline) continue;
    const { problems, warnings } = checkVariant(c);
    out.push({ ...c, problems, warnings });
    if (out.length >= MAX_VARIANTS) break;
  }
  return out;
}

module.exports = withFailureReporting('api/mission-ads', async function handler(req, res) {
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

  if (rateLimited(req, res, { name: 'mission-ads', max: 20, windowMs: 60 * 1000, auth: { userId: caller.id } })) return;

  const body = req.body || {};
  if (body.action !== 'save') return res.status(400).json({ error: `Unknown action "${body.action}". Use 'save'.` });

  const product = str(body.product, 400);
  const audience = str(body.audience, 400);
  if (!product) return res.status(400).json({ error: 'What is being advertised? The product or offer is required.', field: 'product' });
  if (!audience) return res.status(400).json({ error: 'Who is the audience? The target audience is required.', field: 'audience' });
  const platforms = [...new Set((Array.isArray(body.platforms) ? body.platforms : []).filter(p => PLATFORM_SPECS[p]))];
  if (!platforms.length) return res.status(400).json({ error: 'No supported ad platform was given.', field: 'platforms' });
  const objective = OBJECTIVES.includes(body.objective) ? body.objective : 'Conversions';

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
  if (!intelProfileId && !projectId) {
    return res.status(409).json({ error: 'No business profile or project is selected, so the approved ads would have nowhere to be kept. Pick one first.', code: 'no_scope' });
  }

  const variants = cleanVariants(body.variants, platforms);
  if (!variants.length) return res.status(422).json({ error: 'No usable ads were written. Try again — this is usually transient.' });

  const failures = (Array.isArray(body.failures) ? body.failures : []).slice(0, 10).map(f => ({ platform: str(f && f.platform, 40), message: str(f && f.message, 300) }));
  const created = await sb('POST', '/mission_artifacts', {
    user_id: caller.id, intel_profile_id: intelProfileId,
    mission_id: body.missionId ? String(body.missionId).slice(0, 80) : null,
    agent_key: 'ads', kind: 'ad_campaign',
    title: `Ad campaign — ${product.slice(0, 80)}`,
    payload: {
      params: { product, audience, objective, platforms, language: writingLanguage.isSupported(body.language) ? body.language : '', projectId },
      strategyNote: str(body.strategyNote, 1200), variants, failures,
    },
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
    strategyNote: artifact.payload.strategyNote, variants, failures,
    usable: variants.filter(v => !v.problems.length).length,
  });
});

module.exports.checkVariant = checkVariant;
module.exports.cleanVariants = cleanVariants;
