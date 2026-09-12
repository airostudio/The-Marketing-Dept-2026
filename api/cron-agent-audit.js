/**
 * api/cron-agent-audit.js — bi-monthly "stay current" research audit.
 *
 * Triggered by Vercel Cron (see vercel.json) roughly every 2 months. For
 * every specialist agent in the product, asks Claude to research CURRENT
 * (real, live) best practices for that discipline via the Anthropic web
 * search server tool, compare them against a short description of what
 * that agent actually does today, and report concrete gaps — not a
 * regurgitation of training-data knowledge, genuine fresh research each
 * run. Results are written to Supabase (agent_audit_runs /
 * agent_audit_findings — see supabase-agent-audits.sql) and surfaced as a
 * digest banner in Scotty (web/scotty.html).
 *
 * IMPORTANT — what this job does NOT do: it does not modify any other
 * agent's code, prompts, or behavior. It produces a research report for a
 * human (or a coding session) to act on. Auto-patching production files
 * from an unsupervised cron job would be a real safety regression, not a
 * step toward "autonomous" — genuine agentic marketing platforms gate
 * consequential changes behind human review, and code changes are exactly
 * that kind of change.
 *
 * This same principle covers the "AI Model Health" check added below: it
 * runs real, cheap live tests against the actual production model APIs
 * this app depends on (Claude/OpenAI/Gemini) and researches whether those
 * models are still current, but it only ever WRITES A FINDING for a human
 * to review in Scotty's review queue. It never edits api/claude.js,
 * api/openai.js, api/gemini.js, or any other file, and never redeploys
 * anything — detection and surfacing only, exactly like every other
 * finding in this file.
 *
 * Required env vars:
 *   ANTHROPIC_API_KEY — same key api/claude.js uses; also used for the
 *     Claude live-test and the model-health research call below.
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY — data access (service role,
 *     since a cron job has no logged-in user session — see
 *     api/cron-auto-publish.js for the same pattern)
 *   CRON_SECRET — Vercel sends `Authorization: Bearer <CRON_SECRET>` on its
 *     own scheduled invocations once this is set; anything else is rejected.
 *   OPENAI_API_KEY, GEMINI_API_KEY — optional. Used only by the AI Model
 *     Health check's live tests for those providers; if either is absent,
 *     that provider's models are reported as `skipped` (a deployment-config
 *     fact) rather than failing the whole audit run.
 */

'use strict';

const { withFailureReporting } = require('./_lib/report-failure.js');
const { anthropicHeaders } = require('./_lib/anthropic-headers.js');
const WEB_SEARCH_MAX_USES_PER_AGENT = 4;
const PER_AGENT_TIMEOUT_MS = 40000; // leaves headroom inside the 60s function ceiling for the Supabase writes after all agents settle
const MODEL = 'claude-sonnet-4-6';

// One entry per specialist agent — agentKey should match (or map cleanly
// onto) the AGENT_META keys used in web/scotty.html, so findings can link
// straight back to the right agent page.
const AGENT_REGISTRY = [
  { key: 'seo', label: 'SEO Intelligence (Rex)', discipline: 'SEO / organic search strategy',
    currentApproach: 'LLM-generated keyword research, content briefs, and technical SEO guidance from a business-context prompt, plus a real Google PageSpeed Insights "Express Check" for live performance/SEO/accessibility scores.' },
  { key: 'content', label: 'Content Studio (Ink)', discipline: 'content marketing strategy and long-form content creation',
    currentApproach: 'LLM-generated content strategy, briefs, and drafts from a topic + business-context prompt.' },
  { key: 'cro', label: 'CRO Lab', discipline: 'conversion rate optimization',
    currentApproach: 'LLM-generated CRO recommendations and test ideas from a page/funnel description prompt, with A/B test statistics (real sample-size and significance math) available via a related MCP tool, not wired directly into this agent yet.' },
  { key: 'email', label: 'Email Engine (Nova)', discipline: 'email marketing copywriting',
    currentApproach: 'LLM-generated email copy/sequences from a campaign brief prompt; handed off to Pat (Email Delivery) for actual sending.' },
  { key: 'email-delivery', label: 'Email Delivery (Pat)', discipline: 'email deliverability and campaign sending',
    currentApproach: 'Sends real campaigns via a configured ESP/SMTP provider, with recipient lists pulled from Beeker\'s segments; also has a Social Posting tab for publishing approved social content.' },
  { key: 'audience', label: 'Audience Manager (Beeker)', discipline: 'contact/audience management and segmentation',
    currentApproach: 'Supabase-backed contacts and segments, manual and LLM-assisted segmentation, receives leads handed off from Sales/LinkedIn pipelines; also runs a content calendar for scheduling social posts.' },
  { key: 'sales', label: 'Sales Intelligence (Chase)', discipline: 'sales/lead intelligence and outbound',
    currentApproach: 'LLM-generated prospect research, outreach drafts, and lead scoring from business-context + prospect input; hands qualified prospects to Beeker\'s audience segments.' },
  { key: 'social', label: 'Social Studio / Ad Creative Lab (Pulse)', discipline: 'organic social media and paid social ad creative',
    currentApproach: 'Organic posts generated via Claude with structured output (recently updated to bias toward carousels/Reels, keyword-rich captions over hashtag stuffing, and UGC prompts); paid ad copy generated via Claude across 8 direct-response frameworks; real AI-generated ad images via OpenAI gpt-image-1, credit-metered; draft-only (never-active) campaign push to Meta\'s Marketing API via a related MCP tool.' },
  { key: 'linkedin', label: 'LinkedIn Outreach (Mex)', discipline: 'LinkedIn prospecting and outreach',
    currentApproach: 'LLM-generated connection request and outreach message drafts, plus a manual prospect pipeline (stage tracking: new/connected/messaged/replied/meeting/won/lost) that hands qualified prospects to Beeker. No direct LinkedIn API/automation integration — messages are drafted for the user to send manually.' },
  { key: 'video', label: 'Video Studio (Reel)', discipline: 'short-form marketing video',
    currentApproach: 'LLM-generated video scripts (hook/timestamps/B-roll/thumbnail concept), optional Tavus avatar-video generation from the script, and a separate real AI video generator (Seedance 2.0, text-to-video and image-to-video) for direct prompt-to-clip generation.' },
  { key: 'competitive', label: 'Competitive Intel', discipline: 'competitive intelligence and monitoring',
    currentApproach: 'LLM-inferred competitor positioning, messaging, and gap analysis from user-provided competitor names/URLs — no live scraping or automated competitor data gathering.' },
  { key: 'analytics', label: 'Analytics Brain', discipline: 'marketing analytics and attribution',
    currentApproach: 'LLM-narrated analysis and recommendations from user-provided or connected analytics data.' },
  { key: 'compliance', label: 'Compliance Guard (Shield)', discipline: 'marketing regulatory compliance (advertising/privacy/email law)',
    currentApproach: 'LLM-generated compliance guidance and content review against a set of regulatory frameworks the system prompt encodes.' },
  { key: 'compliance-automation', label: 'Enterprise Compliance Automation (Lock)', discipline: 'enterprise-grade compliance automation and audit trails',
    currentApproach: 'LLM-generated compliance workflows/checklists for enterprise clients, building on Shield\'s guidance.' },
  { key: 'deck', label: 'Deck Maker', discipline: 'AI presentation/deck generation',
    currentApproach: 'Generates real .pptx files (via a Python-based generation pipeline) from an LLM-written outline/content plan, with a Gemini-based spell-check pass.' },
];

// ── AI Model Health ──────────────────────────────────────────────────────
// One entry per distinct model string actually found in production code —
// verified against the real source files, not guessed. See the file header
// for each model's exact source:
//   Claude text  -> api/claude.js DEFAULT_MODEL
//   OpenAI text  -> api/openai.js default `model`
//   OpenAI image -> api/generate-ad-image.js / api/_lib/nancy-providers.js
//   Gemini text  -> api/gemini.js default `model` (server default), plus the
//                   faster client-side tier from web/js/config.js GEMINI.MODEL
//   Gemini image -> api/_lib/nancy-providers.js imageGenProvider 'gemini' branch
const MODEL_REGISTRY = [
  {
    id: 'claude-sonnet-4-6',
    provider: 'anthropic',
    kind: 'text',
    usedIn: 'api/claude.js (DEFAULT_MODEL) and most other Claude-calling endpoints (Scotty chat, Nancy\'s Instagram pipeline, Chase outreach, ad/social copy, this audit itself)',
    purpose: 'general chat/completion',
  },
  {
    id: 'gpt-5.6-luna',
    provider: 'openai',
    kind: 'text',
    usedIn: 'api/openai.js (default model), used by Social Studio and Chase\'s Outreach Generator when OpenAI is selected',
    purpose: 'general chat/completion',
  },
  {
    id: 'gpt-image-1',
    provider: 'openai',
    kind: 'image',
    usedIn: 'api/generate-ad-image.js (OPENAI_IMAGE_MODEL default) and api/_lib/nancy-providers.js imageGenProvider \'openai\' branch',
    purpose: 'ad image generation',
  },
  {
    id: 'gemini-3.1-pro-preview',
    provider: 'gemini',
    kind: 'text',
    usedIn: 'api/gemini.js (default model), and web/js/config.js GEMINI.PRO_MODEL for complex client-side tasks',
    purpose: 'general chat/completion (higher-capability tier)',
  },
  {
    id: 'gemini-3.5-flash',
    provider: 'gemini',
    kind: 'text',
    usedIn: 'web/js/config.js GEMINI.MODEL — faster/cheaper client-side tier',
    purpose: 'general chat/completion (fast/cost-effective tier)',
  },
  {
    id: 'gemini-2.5-flash-image',
    provider: 'gemini',
    kind: 'image',
    usedIn: 'api/_lib/nancy-providers.js imageGenProvider \'gemini\' branch (env-overridable via GEMINI_IMAGE_MODEL)',
    purpose: 'ad image generation',
  },
];

const MODEL_TEST_TIMEOUT_MS = 15000;

/** Truncate a live error to something readable/storable without losing the actionable part. */
function truncateErr(s, max = 500) {
  s = String(s == null ? '' : s);
  return s.length > max ? s.slice(0, max) + '…' : s;
}

/**
 * Run one real, minimal, cheap live test/existence-check against a model's
 * actual production API, mirroring the exact request shape the real
 * endpoint file currently sends. Never throws — a network failure or
 * timeout is itself a legitimate ok:false result, not a crash of the audit.
 * Skips (does not fail) a model whose required API key isn't configured.
 */
async function testModelLive(entry, apiKeys) {
  const { id, provider } = entry;
  try {
    if (provider === 'anthropic') {
      const apiKey = apiKeys.anthropic;
      if (!apiKey) return { id, provider, skipped: true, reason: 'ANTHROPIC_API_KEY not configured' };
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: anthropicHeaders(apiKey),
        body: JSON.stringify({
          model: id,
          max_tokens: 8,
          messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
        }),
        signal: AbortSignal.timeout(MODEL_TEST_TIMEOUT_MS),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        return { id, provider, ok: false, status: res.status, error: truncateErr(data.error?.message || `Anthropic error ${res.status}`) };
      }
      return { id, provider, ok: true };
    }

    if (provider === 'openai') {
      const apiKey = apiKeys.openai;
      if (!apiKey) return { id, provider, skipped: true, reason: 'OPENAI_API_KEY not configured' };

      if (entry.kind === 'image') {
        // A real generation call costs real money per check, and this needs
        // to run often — instead, confirm the model id still exists/is
        // accessible via the models-retrieve endpoint. Chat models below get
        // a real 8-token completion test because that's cheap; image models
        // get an existence check instead.
        const res = await fetch(`https://api.openai.com/v1/models/${encodeURIComponent(id)}`, {
          method: 'GET',
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(MODEL_TEST_TIMEOUT_MS),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          return { id, provider, ok: false, status: res.status, error: truncateErr(data.error?.message || `OpenAI error ${res.status}`) };
        }
        return { id, provider, ok: true };
      }

      // Mirrors api/openai.js's CURRENT body shape exactly — max_completion_tokens,
      // not max_tokens (that rename is exactly the incident this check exists to catch).
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: id,
          messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
          max_completion_tokens: 8,
        }),
        signal: AbortSignal.timeout(MODEL_TEST_TIMEOUT_MS),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        return { id, provider, ok: false, status: res.status, error: truncateErr(data.error?.message || `OpenAI error ${res.status}`) };
      }
      return { id, provider, ok: true };
    }

    if (provider === 'gemini') {
      const apiKey = apiKeys.gemini;
      if (!apiKey) return { id, provider, skipped: true, reason: 'GEMINI_API_KEY not configured' };

      if (entry.kind === 'image') {
        // Same "existence check" approach as OpenAI images — a GET against
        // the model-info endpoint rather than a real paid image generation
        // call every run.
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(id)}?key=${apiKey}`, {
          method: 'GET',
          signal: AbortSignal.timeout(MODEL_TEST_TIMEOUT_MS),
        });
        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          return { id, provider, ok: false, status: res.status, error: truncateErr(errText || `Gemini error ${res.status}`) };
        }
        return { id, provider, ok: true };
      }

      // Mirrors api/gemini.js's exact non-streaming generateContent request shape.
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(id)}:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: 'Reply with exactly: OK' }] }],
          generationConfig: { maxOutputTokens: 8, temperature: 0.7 },
        }),
        signal: AbortSignal.timeout(MODEL_TEST_TIMEOUT_MS),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        return { id, provider, ok: false, status: res.status, error: truncateErr(errText || `Gemini error ${res.status}`) };
      }
      return { id, provider, ok: true };
    }

    return { id, provider, ok: false, error: `Unknown provider "${provider}"` };
  } catch (err) {
    const isTimeout = err && (err.name === 'TimeoutError' || err.name === 'AbortError');
    return { id, provider, ok: false, error: truncateErr(isTimeout ? 'Request timed out' : (err && err.message) || String(err)) };
  }
}

function buildModelHealthPrompt(liveResults) {
  const today = new Date().toISOString().slice(0, 10);
  const modelList = MODEL_REGISTRY.map((m) => `- ${m.id} (${m.provider}, ${m.kind}) — ${m.usedIn}`).join('\n');
  const liveSummary = JSON.stringify(
    liveResults.map((r) => ({ id: r.id, provider: r.provider, ok: r.ok ?? null, skipped: !!r.skipped, status: r.status ?? null, error: r.error || null })),
    null,
    2
  );

  return `Today's date is ${today}. You are auditing the AI MODELS this marketing platform depends on in production — not any specialist agent's prompt or workflow, the underlying model dependencies themselves.

## MODELS ACTUALLY IN USE TODAY
${modelList}

## LIVE PRODUCTION TEST RESULTS (just run, moments ago, against the real APIs)
${liveSummary}

Any model above marked "ok": false is a CONFIRMED, currently-happening failure against the real production API — not something to verify, something already proven broken right now. A model marked "skipped": true simply has no API key configured in this environment for testing; that is not evidence of a model problem.

## YOUR TASK
1. Use web search to check, for EACH model listed above, current (this year, dated) information on:
   - Whether it has been deprecated, or has an announced sunset/retirement date.
   - Whether a newer model in the same family/tier from the same provider has been released with better price and/or performance, that this app should consider migrating to.
   - Anything else about to break: an announced upcoming API change to that model or its request/response shape (the kind of thing that already broke this app once — OpenAI renamed max_tokens to max_completion_tokens for its newer models, silently breaking every caller until a customer hit the error).
2. Never guess or state a pricing/capability comparison you did not find via search. If you cannot find current information for a model, say so plainly rather than reasoning from training data.
3. Call submit_agent_audit_finding with your structured findings. Merge the live test results above into your gaps/summary using the exact verbatim error text for anything that failed live — do not paraphrase it.
4. Set upToDate to true only if every model tested live is healthy AND you found no deprecation/sunset/imminent-breaking-change risk for any model in the list.

Search first, then call submit_agent_audit_finding as your final action. Do not respond with plain text.`;
}

async function auditModelHealth(apiKey, liveTestResults) {
  const anyLiveFailure = liveTestResults.some((r) => r.ok === false);

  const body = {
    model: MODEL,
    max_tokens: 2000,
    messages: [{ role: 'user', content: buildModelHealthPrompt(liveTestResults) }],
    tools: [
      { type: 'web_search_20250305', name: 'web_search', max_uses: WEB_SEARCH_MAX_USES_PER_AGENT },
      FINDING_TOOL,
    ],
  };

  let finding;
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: anthropicHeaders(apiKey),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(PER_AGENT_TIMEOUT_MS),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error?.message || `Anthropic error ${res.status}`);
    if (data.stop_reason === 'pause_turn') {
      throw new Error('Search took too long and paused mid-turn — treating as a timeout for this run (will retry next scheduled audit).');
    }
    const toolUse = (data.content || []).find((b) => b.type === 'tool_use' && b.name === 'submit_agent_audit_finding');
    if (!toolUse) throw new Error('Claude did not return a structured finding for model health.');
    finding = toolUse.input;
  } catch (err) {
    // The research call failing does not excuse us from surfacing confirmed
    // live-test failures — those are ground truth measured moments ago,
    // independent of whether Claude's research call succeeded.
    finding = {
      upToDate: !anyLiveFailure,
      summary: `Model-health research call failed (${err.message}); reporting live test results only.`,
      gaps: [],
      recommendations: [],
      securityNotes: [],
      sources: [],
    };
  }

  // Live-test failures are ground truth. Merge them into gaps verbatim, and
  // force upToDate false regardless of what Claude's research concluded — an
  // LLM's judgment must never be allowed to soften or override a confirmed,
  // currently-happening API failure.
  const liveFailureGaps = liveTestResults
    .filter((r) => r.ok === false)
    .map((r) => `LIVE TEST FAILED for ${r.id} (${r.provider}): ${r.status ? `HTTP ${r.status} — ` : ''}${r.error}`);

  const gaps = liveFailureGaps.concat(Array.isArray(finding.gaps) ? finding.gaps : []);
  const upToDate = anyLiveFailure ? false : !!finding.upToDate;

  return {
    upToDate,
    summary: finding.summary || '',
    gaps,
    recommendations: Array.isArray(finding.recommendations) ? finding.recommendations : [],
    securityNotes: Array.isArray(finding.securityNotes) ? finding.securityNotes : [],
    sources: Array.isArray(finding.sources) ? finding.sources : [],
  };
}

const FINDING_TOOL = {
  name: 'submit_agent_audit_finding',
  description: 'Submit your research findings for this agent as structured data.',
  input_schema: {
    type: 'object',
    properties: {
      upToDate: { type: 'boolean', description: 'true only if you found no meaningful gap between current best practice and what this agent does today' },
      summary: { type: 'string', description: '2-3 sentence overview of your finding' },
      gaps: { type: 'array', items: { type: 'string' }, description: 'Specific, concrete gaps — "X best practice exists, this agent does Y instead." Empty array if none found.' },
      recommendations: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            text: { type: 'string' },
            impact: { type: 'string', enum: ['high', 'medium', 'low'] },
          },
          required: ['text', 'impact'],
        },
        description: 'Concrete, actionable recommendations ranked by impact. Empty array if upToDate is true.',
      },
      securityNotes: { type: 'array', items: { type: 'string' }, description: 'Any security, privacy, legal, or platform-policy risk relevant to this agent\'s discipline. Empty array if none.' },
      sources: {
        type: 'array',
        items: { type: 'object', properties: { title: { type: 'string' }, url: { type: 'string' } }, required: ['url'] },
        description: 'The real sources you found via web search that inform this finding.',
      },
    },
    required: ['upToDate', 'summary', 'gaps', 'recommendations', 'securityNotes', 'sources'],
  },
};

function buildPrompt(agent) {
  return `You are auditing the "${agent.label}" agent in an AI marketing platform against CURRENT, real-world best practices for its discipline: ${agent.discipline}.

## WHAT THIS AGENT DOES TODAY
${agent.currentApproach}

## YOUR TASK
1. Use web search to research current, up-to-date (this year) best practices, industry standards, platform policy changes, and any relevant regulatory requirements for ${agent.discipline}. Search for real, recent, dated information — not what you already know from training.
2. Compare what you find against what this agent does today (above).
3. Call submit_agent_audit_finding with your structured findings. Every gap and recommendation must be specific and actionable — never vague ("could be more modern"). Every security/legal/platform-policy risk you can identify for this discipline must be flagged, even if minor.
4. If you genuinely find no meaningful gap, set upToDate to true and say so plainly — do not manufacture a gap to seem thorough.

Search first, then call submit_agent_audit_finding as your final action. Do not respond with plain text.`;
}

async function auditOneAgent(apiKey, agent) {
  const body = {
    model: MODEL,
    max_tokens: 2000,
    messages: [{ role: 'user', content: buildPrompt(agent) }],
    tools: [
      { type: 'web_search_20250305', name: 'web_search', max_uses: WEB_SEARCH_MAX_USES_PER_AGENT },
      FINDING_TOOL,
    ],
  };

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: anthropicHeaders(apiKey),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(PER_AGENT_TIMEOUT_MS),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error?.message || `Anthropic error ${res.status}`);
  }

  if (data.stop_reason === 'pause_turn') {
    throw new Error('Search took too long and paused mid-turn — treating as a timeout for this run (will retry next scheduled audit).');
  }

  const toolUse = (data.content || []).find((b) => b.type === 'tool_use' && b.name === 'submit_agent_audit_finding');
  if (!toolUse) {
    throw new Error('Claude did not return a structured finding for this agent.');
  }

  return toolUse.input;
}

async function sb(supabaseUrl, serviceKey, method, path, body) {
  const res = await fetch(`${supabaseUrl}/rest/v1${path}`, {
    method,
    headers: {
      'apikey': serviceKey,
      'Authorization': `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data };
}

module.exports = withFailureReporting('api/cron-agent-audit', async function handler(req, res) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return res.status(500).json({ error: 'CRON_SECRET is not configured — refusing to run an unauthenticated agent audit.' });
  }
  if (req.headers['authorization'] !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured.' });

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: 'SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not configured.' });
  }

  const openaiKey = process.env.OPENAI_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;

  const [results, modelHealthResult] = await Promise.all([
    Promise.allSettled(AGENT_REGISTRY.map((agent) => auditOneAgent(apiKey, agent))),
    (async () => {
      try {
        const liveTestResults = (await Promise.allSettled(
          MODEL_REGISTRY.map((entry) => testModelLive(entry, { anthropic: apiKey, openai: openaiKey, gemini: geminiKey }))
        )).map((r, i) => (r.status === 'fulfilled' ? r.value : { id: MODEL_REGISTRY[i].id, provider: MODEL_REGISTRY[i].provider, ok: false, error: truncateErr((r.reason && r.reason.message) || String(r.reason)) }));

        const testedResults = liveTestResults.filter((r) => !r.skipped);
        const finding = await auditModelHealth(apiKey, testedResults);
        return { status: 'fulfilled', value: finding };
      } catch (err) {
        // Matches this file's own documented convention: no finding on a
        // failed run — don't falsely flag as needing work.
        return { status: 'fulfilled', value: { upToDate: true, summary: null, gaps: [], recommendations: [], securityNotes: [], sources: [], error: err instanceof Error ? err.message : String(err) } };
      }
    })(),
  ]);

  const findings = results.map((result, i) => {
    const agent = AGENT_REGISTRY[i];
    if (result.status === 'fulfilled') {
      const f = result.value;
      return {
        run_id: null, // filled in after the run row is created
        agent_key: agent.key,
        agent_label: agent.label,
        up_to_date: !!f.upToDate,
        summary: f.summary || null,
        gaps: f.gaps || [],
        recommendations: f.recommendations || [],
        security_notes: f.securityNotes || [],
        sources: f.sources || [],
        error: null,
      };
    }
    return {
      run_id: null,
      agent_key: agent.key,
      agent_label: agent.label,
      up_to_date: true, // no finding — don't falsely flag as "needs work" on a failed run
      summary: null,
      gaps: [],
      recommendations: [],
      security_notes: [],
      sources: [],
      error: result.reason instanceof Error ? result.reason.message : String(result.reason),
    };
  });

  // The AI Model Health check is folded into the SAME run/findings array as
  // every specialist agent — same run row, same insert, agent_key
  // 'platform-model-health' (a reserved pseudo-agent-key; see
  // supabase-agent-audits.sql).
  const modelHealthFinding = modelHealthResult.value;
  findings.push({
    run_id: null,
    agent_key: 'platform-model-health',
    agent_label: 'AI Model Health (Platform Infrastructure)',
    up_to_date: modelHealthFinding.error ? true : !!modelHealthFinding.upToDate,
    summary: modelHealthFinding.summary || null,
    gaps: modelHealthFinding.gaps || [],
    recommendations: modelHealthFinding.recommendations || [],
    security_notes: modelHealthFinding.securityNotes || [],
    sources: modelHealthFinding.sources || [],
    error: modelHealthFinding.error || null,
  });

  const agentCount = AGENT_REGISTRY.length + 1; // + AI Model Health
  const failedCount = findings.filter((f) => f.error).length;
  const flaggedCount = findings.filter((f) => !f.up_to_date).length;
  const status = failedCount === 0 ? 'completed' : (failedCount === findings.length ? 'failed' : 'partial');

  const overallSummary = `Audited ${agentCount} agents — ${flaggedCount} flagged with gaps, ${failedCount} failed to complete research${failedCount ? ' (will retry next scheduled run)' : ''}.`;

  const runInsert = await sb(supabaseUrl, serviceKey, 'POST', '/agent_audit_runs', {
    status,
    agent_count: agentCount,
    flagged_count: flaggedCount,
    overall_summary: overallSummary,
  });

  if (!runInsert.ok || !runInsert.data?.[0]?.id) {
    return res.status(502).json({ error: 'Failed to create agent_audit_runs row.', detail: runInsert.data });
  }

  const runId = runInsert.data[0].id;
  const findingsWithRunId = findings.map((f) => ({ ...f, run_id: runId }));

  const findingsInsert = await sb(supabaseUrl, serviceKey, 'POST', '/agent_audit_findings', findingsWithRunId);
  if (!findingsInsert.ok) {
    return res.status(502).json({ error: 'Run created but failed to save findings.', runId, detail: findingsInsert.data });
  }

  return res.json({ success: true, runId, status, agentCount, flaggedCount, failedCount, overallSummary });
});

// Exposed for tests/model-health/run.js only — Vercel invokes module.exports
// directly as a function, so these extra properties are inert in production.
module.exports.MODEL_REGISTRY = MODEL_REGISTRY;
module.exports.testModelLive = testModelLive;
module.exports.auditModelHealth = auditModelHealth;
