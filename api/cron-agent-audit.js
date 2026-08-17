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
 * Required env vars:
 *   ANTHROPIC_API_KEY — same key api/claude.js uses
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY — data access (service role,
 *     since a cron job has no logged-in user session — see
 *     api/cron-auto-publish.js for the same pattern)
 *   CRON_SECRET — Vercel sends `Authorization: Bearer <CRON_SECRET>` on its
 *     own scheduled invocations once this is set; anything else is rejected.
 */

'use strict';

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
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
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

module.exports = async function handler(req, res) {
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

  const results = await Promise.allSettled(AGENT_REGISTRY.map((agent) => auditOneAgent(apiKey, agent)));

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

  const failedCount = findings.filter((f) => f.error).length;
  const flaggedCount = findings.filter((f) => !f.up_to_date).length;
  const status = failedCount === 0 ? 'completed' : (failedCount === findings.length ? 'failed' : 'partial');

  const overallSummary = `Audited ${AGENT_REGISTRY.length} agents — ${flaggedCount} flagged with gaps, ${failedCount} failed to complete research${failedCount ? ' (will retry next scheduled run)' : ''}.`;

  const runInsert = await sb(supabaseUrl, serviceKey, 'POST', '/agent_audit_runs', {
    status,
    agent_count: AGENT_REGISTRY.length,
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

  return res.json({ success: true, runId, status, agentCount: AGENT_REGISTRY.length, flaggedCount, failedCount, overallSummary });
};
