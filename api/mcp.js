/**
 * api/mcp.js — Audema A/B Testing MCP Server (HTTP transport)
 *
 * Implements the Model Context Protocol (MCP) Streamable HTTP transport.
 * Claude Desktop / Cursor / any MCP client connects to this endpoint.
 *
 * Endpoint: POST /api/mcp
 * Protocol:  JSON-RPC 2.0 (MCP spec 2025-03-26)
 *
 * Authentication: Authorization: Bearer <MCP_SECRET> header
 *
 * Required env vars:
 *   SUPABASE_URL              — your Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY — service-role key (server-side only, never exposed client-side)
 *   MCP_SECRET                — bearer token required by all MCP clients
 *   ANTHROPIC_API_KEY         — for the ad creative loop tool
 *
 * MCP client config (Claude Desktop / Cursor):
 *   {
 *     "mcpServers": {
 *       "aduma": {
 *         "type": "http",
 *         "url": "https://<your-vercel-domain>/api/mcp",
 *         "headers": { "Authorization": "Bearer <MCP_SECRET>" }
 *       }
 *     }
 *   }
 *
 * Tools exposed:
 *   list_experiments         List all A/B experiments with status + quick stats
 *   get_experiment_stats     Full stats for one experiment: CVR, uplift, significance
 *   create_experiment        Create a new experiment
 *   add_variant              Add a variant to an existing experiment
 *   update_experiment        Change status (draft→active→paused→finished) or metadata
 *   declare_winner           Mark a variant as the winner and close the experiment
 *   create_goal              Add a conversion goal to an experiment
 *   get_winning_copy         Return winning copy from all finished experiments (for ads)
 *   generate_tracking_snippet  Return the JS embed snippet for an experiment
 *   generate_ads_from_winner   Ad creative loop: winner copy → new ad variants via Claude
 */

'use strict';

// ── Supabase REST helper ───────────────────────────────────────────────────
async function sb(env, method, path, body) {
  const url = `${env.SUPABASE_URL}/rest/v1${path}`;
  const headers = {
    'apikey':        env.SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type':  'application/json',
    'Prefer':        method === 'POST' ? 'return=representation' : 'return=representation',
  };
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(12000),
  });
  const text = await res.text();
  try { return { ok: res.ok, status: res.status, data: JSON.parse(text) }; }
  catch { return { ok: res.ok, status: res.status, data: text }; }
}

// ── Statistics helpers ─────────────────────────────────────────────────────

// Wilson score confidence interval (for conversion rate)
function wilsonCI(conversions, visitors, z = 1.96) {
  if (!visitors) return { lower: 0, upper: 0 };
  const p = conversions / visitors;
  const denom = 1 + z * z / visitors;
  const center = (p + z * z / (2 * visitors)) / denom;
  const spread = (z * Math.sqrt(p * (1 - p) / visitors + z * z / (4 * visitors * visitors))) / denom;
  return { lower: Math.max(0, center - spread), upper: Math.min(1, center + spread) };
}

// Z-test for two proportions
function zTest(p1, n1, p2, n2) {
  if (!n1 || !n2) return { z: 0, pValue: 1, significant: false };
  const pooled = (p1 * n1 + p2 * n2) / (n1 + n2);
  const se     = Math.sqrt(pooled * (1 - pooled) * (1 / n1 + 1 / n2));
  if (!se) return { z: 0, pValue: 1, significant: false };
  const z      = Math.abs((p1 - p2) / se);
  // Approximate two-tailed p-value (normal distribution CDF)
  const pValue = 2 * (1 - normalCDF(z));
  return { z: +z.toFixed(3), pValue: +pValue.toFixed(4), significant: pValue < 0.05 };
}

function normalCDF(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const poly = t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const cdf  = 1 - 0.3989422804 * Math.exp(-0.5 * z * z) * poly;
  return z >= 0 ? cdf : 1 - cdf;
}

// ── Tool implementations ───────────────────────────────────────────────────

async function tool_list_experiments(args, env) {
  const res = await sb(env, 'GET', '/experiments?select=id,name,description,status,type,start_date,end_date,winner_variant_id,created_at&order=created_at.desc&limit=50');
  if (!res.ok) throw new Error(`Supabase error: ${JSON.stringify(res.data)}`);

  const exps = Array.isArray(res.data) ? res.data : [];
  if (!exps.length) return 'No experiments found. Create one with create_experiment.';

  const rows = exps.map(e =>
    `• [${e.id.slice(0,8)}] "${e.name}" — ${e.status}${e.winner_variant_id ? ' ✓ Winner declared' : ''} (${e.type || 'ab'}) ${e.start_date ? 'Started: ' + e.start_date.slice(0,10) : 'Not started'}`
  ).join('\n');

  return `**${exps.length} Experiments**\n\n${rows}`;
}

async function tool_get_experiment_stats(args, env) {
  const { experiment_id } = args;
  if (!experiment_id) throw new Error('experiment_id is required');

  const [expRes, varRes, convRes, visRes] = await Promise.all([
    sb(env, 'GET', `/experiments?id=eq.${experiment_id}&select=*`),
    sb(env, 'GET', `/variants?experiment_id=eq.${experiment_id}&select=*`),
    sb(env, 'GET', `/conversions?experiment_id=eq.${experiment_id}&select=variant_id`),
    sb(env, 'GET', `/visitors?experiment_id=eq.${experiment_id}&select=variant_id`),
  ]);

  const exp      = expRes.data?.[0];
  if (!exp) throw new Error(`Experiment ${experiment_id} not found`);
  const variants  = varRes.data || [];
  const convs     = convRes.data || [];
  const visitors  = visRes.data || [];

  // Aggregate counts per variant
  const variantStats = variants.map(v => {
    const vis  = visitors.filter(x => x.variant_id === v.id).length;
    const conv = convs.filter(x => x.variant_id === v.id).length;
    const cvr  = vis > 0 ? (conv / vis * 100) : 0;
    return { ...v, visitors: vis, conversions: conv, cvr };
  });

  // Calculate uplift + significance vs control
  const control = variantStats.find(v => v.is_control) || variantStats[0];
  const lines = variantStats.map(v => {
    if (v.id === control?.id) {
      return `• **${v.name}** (control) — ${v.visitors} visitors, ${v.conversions} conv, CVR: ${v.cvr.toFixed(2)}%`;
    }
    const uplift = control?.cvr > 0 ? ((v.cvr - control.cvr) / control.cvr * 100).toFixed(1) : '—';
    const test   = zTest(v.cvr / 100, v.visitors, (control?.cvr || 0) / 100, control?.visitors || 0);
    const sig    = test.significant ? '✓ significant (p<0.05)' : '~ not yet significant';
    return `• **${v.name}** — ${v.visitors} visitors, ${v.conversions} conv, CVR: ${v.cvr.toFixed(2)}%, Uplift: ${uplift}%, ${sig}`;
  }).join('\n');

  const totalVisitors = variantStats.reduce((s, v) => s + v.visitors, 0);
  const totalConvs    = variantStats.reduce((s, v) => s + v.conversions, 0);

  return `**"${exp.name}" — ${exp.status}**
Type: ${exp.type || 'A/B'} | Started: ${exp.start_date?.slice(0,10) || 'Not started'} | Goal: ${exp.primary_goal_id || 'None set'}
Total: ${totalVisitors} visitors, ${totalConvs} conversions

**Variant Performance:**
${lines}

${exp.winner_variant_id ? `✓ Winner declared: ${variantStats.find(v=>v.id===exp.winner_variant_id)?.name || exp.winner_variant_id}` : '— No winner declared yet'}`;
}

async function tool_create_experiment(args, env) {
  const { name, description, type = 'ab' } = args;
  if (!name) throw new Error('name is required');

  const res = await sb(env, 'POST', '/experiments', {
    name, description: description || '', type, status: 'draft',
  });
  if (!res.ok) throw new Error(`Failed to create experiment: ${JSON.stringify(res.data)}`);

  const exp = Array.isArray(res.data) ? res.data[0] : res.data;
  return `✓ Experiment created: "${exp.name}" (ID: ${exp.id})\n\nNext steps:\n1. Add variants with add_variant\n2. Add a conversion goal with create_goal\n3. Generate the tracking snippet with generate_tracking_snippet\n4. Set status to active with update_experiment when ready`;
}

async function tool_add_variant(args, env) {
  const { experiment_id, name, is_control = false, traffic_allocation = 50, redirect_url, description } = args;
  if (!experiment_id || !name) throw new Error('experiment_id and name are required');

  const res = await sb(env, 'POST', '/variants', {
    experiment_id, name, is_control, traffic_allocation,
    redirect_url: redirect_url || null,
    description: description || '',
  });
  if (!res.ok) throw new Error(`Failed to add variant: ${JSON.stringify(res.data)}`);

  const v = Array.isArray(res.data) ? res.data[0] : res.data;
  return `✓ Variant "${v.name}" added (ID: ${v.id}) — ${traffic_allocation}% traffic${is_control ? ' [CONTROL]' : ''}`;
}

async function tool_update_experiment(args, env) {
  const { experiment_id, status, name, description, start_date, end_date } = args;
  if (!experiment_id) throw new Error('experiment_id is required');

  const patch = {};
  if (status)      { patch.status     = status; }
  if (name)        { patch.name       = name; }
  if (description) { patch.description = description; }
  if (start_date)  { patch.start_date = start_date; }
  if (end_date)    { patch.end_date   = end_date; }
  patch.updated_at = new Date().toISOString();

  const res = await sb(env, 'PATCH', `/experiments?id=eq.${experiment_id}`, patch);
  if (!res.ok) throw new Error(`Failed to update: ${JSON.stringify(res.data)}`);

  return `✓ Experiment ${experiment_id} updated. Status: ${status || 'unchanged'}`;
}

async function tool_declare_winner(args, env) {
  const { experiment_id, variant_id, reason } = args;
  if (!experiment_id || !variant_id) throw new Error('experiment_id and variant_id are required');

  const res = await sb(env, 'PATCH', `/experiments?id=eq.${experiment_id}`, {
    winner_variant_id: variant_id,
    status:            'finished',
    end_date:          new Date().toISOString(),
    updated_at:        new Date().toISOString(),
  });
  if (!res.ok) throw new Error(`Failed to declare winner: ${JSON.stringify(res.data)}`);

  const varRes = await sb(env, 'GET', `/variants?id=eq.${variant_id}&select=name`);
  const varName = varRes.data?.[0]?.name || variant_id;

  return `✓ Winner declared: "${varName}" for experiment ${experiment_id}.\n${reason ? `Reason: ${reason}` : ''}\nExperiment status set to "finished".\n\nTip: Run generate_ads_from_winner to generate new ad variants based on this winning copy.`;
}

async function tool_create_goal(args, env) {
  const { experiment_id, name, type = 'click', selector, url_pattern, is_primary = false } = args;
  if (!experiment_id || !name) throw new Error('experiment_id and name are required');

  const res = await sb(env, 'POST', '/goals', {
    experiment_id, name, type, is_primary,
    selector:    selector    || null,
    url_pattern: url_pattern || null,
  });
  if (!res.ok) throw new Error(`Failed to create goal: ${JSON.stringify(res.data)}`);

  const goal = Array.isArray(res.data) ? res.data[0] : res.data;

  if (is_primary) {
    await sb(env, 'PATCH', `/experiments?id=eq.${experiment_id}`, {
      primary_goal_id: goal.id, updated_at: new Date().toISOString(),
    });
  }

  return `✓ Goal "${goal.name}" created (${type}) for experiment ${experiment_id}${is_primary ? ' [PRIMARY]' : ''}.${selector ? `\nSelector: ${selector}` : ''}${url_pattern ? `\nURL pattern: ${url_pattern}` : ''}`;
}

async function tool_get_winning_copy(args, env) {
  const res = await sb(env, 'GET', '/experiments?status=eq.finished&winner_variant_id=not.is.null&select=id,name,winner_variant_id,end_date');
  if (!res.ok) throw new Error(`Supabase error: ${JSON.stringify(res.data)}`);

  const exps = Array.isArray(res.data) ? res.data : [];
  if (!exps.length) return 'No finished experiments with declared winners yet.';

  // Fetch winner variant names
  const winnerIds = exps.map(e => e.winner_variant_id).filter(Boolean);
  const varRes    = await sb(env, 'GET', `/variants?id=in.(${winnerIds.join(',')})&select=id,name,description`);
  const variants  = varRes.data || [];

  const lines = exps.map(e => {
    const v = variants.find(x => x.id === e.winner_variant_id);
    return `• "${e.name}" (finished ${e.end_date?.slice(0,10) || '?'}) → Winner: "${v?.name || '?'}"${v?.description ? ` — ${v.description}` : ''}`;
  }).join('\n');

  return `**Winning Variants from ${exps.length} Finished Experiments:**\n\n${lines}\n\nUse generate_ads_from_winner to turn any of these into new ad variants.`;
}

async function tool_generate_tracking_snippet(args, env) {
  const { experiment_id } = args;
  if (!experiment_id) throw new Error('experiment_id is required');

  const [expRes, varRes, goalRes] = await Promise.all([
    sb(env, 'GET', `/experiments?id=eq.${experiment_id}&select=id,name,type,status`),
    sb(env, 'GET', `/variants?experiment_id=eq.${experiment_id}&select=id,name,is_control,traffic_allocation`),
    sb(env, 'GET', `/goals?experiment_id=eq.${experiment_id}&select=id,name,type,selector,url_pattern,is_primary`),
  ]);

  const exp      = expRes.data?.[0];
  const variants = varRes.data || [];
  const goals    = goalRes.data || [];

  if (!exp) throw new Error(`Experiment ${experiment_id} not found`);
  if (variants.length < 2) throw new Error('Add at least 2 variants before generating a snippet');

  const variantMap = variants.map(v => `    { id: '${v.id}', name: '${v.name}', weight: ${v.traffic_allocation / 100}, isControl: ${v.is_control} }`).join(',\n');
  const goalSelectors = goals.filter(g => g.type === 'click' && g.selector)
    .map(g => `    document.querySelectorAll('${g.selector}').forEach(el => el.addEventListener('click', () => AudemaAB.convert('${g.id}')));`)
    .join('\n');
  const urlGoals = goals.filter(g => g.type === 'pageview' && g.url_pattern)
    .map(g => `  if (window.location.href.includes('${g.url_pattern}')) AudemaAB.convert('${g.id}');`)
    .join('\n');

  const snippet = `<!-- Audema A/B Tracking | Experiment: ${exp.name} -->
<script>
(function() {
  var EXPERIMENT_ID = '${exp.id}';
  var TRACK_URL     = '${process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : ''}/api/ab-track';
  var VARIANTS = [
${variantMap}
  ];

  window.AudemaAB = {
    _variantId: null,
    _visitorId: null,

    _getVisitorId: function() {
      var k = 'aduma_vid';
      var id = localStorage.getItem(k);
      if (!id) { id = Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem(k, id); }
      return id;
    },

    _assignVariant: function() {
      var stored = localStorage.getItem('aduma_exp_' + EXPERIMENT_ID);
      if (stored) return JSON.parse(stored);
      var r = Math.random(), cum = 0;
      for (var i = 0; i < VARIANTS.length; i++) {
        cum += VARIANTS[i].weight;
        if (r < cum) { localStorage.setItem('aduma_exp_' + EXPERIMENT_ID, JSON.stringify(VARIANTS[i])); return VARIANTS[i]; }
      }
      return VARIANTS[VARIANTS.length - 1];
    },

    init: function() {
      this._visitorId = this._getVisitorId();
      var variant = this._assignVariant();
      this._variantId = variant.id;
      document.documentElement.setAttribute('data-ab-variant', variant.name);
      fetch(TRACK_URL, {
        method: 'POST', keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'visit', experimentId: EXPERIMENT_ID, variantId: variant.id, visitorId: this._visitorId })
      });
      return variant;
    },

    convert: function(goalId, metadata) {
      if (!this._variantId) return;
      fetch(TRACK_URL, {
        method: 'POST', keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'convert', experimentId: EXPERIMENT_ID, variantId: this._variantId, visitorId: this._visitorId, goalId: goalId || '${goals.find(g=>g.is_primary)?.id || ''}', metadata: metadata || {} })
      });
    }
  };

  AudemaAB.init();

  // Auto-bind click goals
  document.addEventListener('DOMContentLoaded', function() {
${goalSelectors || '    // No click goals defined yet — call AudemaAB.convert(\'goal_id\') manually'}
${urlGoals || ''}
  });
})();
</script>
<!-- End Audema A/B Tracking -->`;

  return `**Tracking snippet for "${exp.name}"**\n\nPaste this into the \`<head>\` of every page in the experiment:\n\n\`\`\`html\n${snippet}\n\`\`\`\n\n**CSS targeting example:**\n\`\`\`css\n/* Show/hide based on variant */\n[data-ab-variant="Control"] .promo-banner { display: none; }\n[data-ab-variant="Variant B"] .promo-banner { display: block; }\n\`\`\``;
}

async function tool_generate_ads_from_winner(args, env) {
  const { experiment_id, platforms = ['Meta/Facebook', 'LinkedIn'], objective = 'Conversions' } = args;
  if (!experiment_id) throw new Error('experiment_id is required');

  const [expRes, varRes] = await Promise.all([
    sb(env, 'GET', `/experiments?id=eq.${experiment_id}&select=*`),
    sb(env, 'GET', `/variants?experiment_id=eq.${experiment_id}&select=*`),
  ]);

  const exp      = expRes.data?.[0];
  const variants = varRes.data || [];
  if (!exp) throw new Error(`Experiment ${experiment_id} not found`);
  if (!exp.winner_variant_id) throw new Error('No winner declared for this experiment yet. Use declare_winner first.');

  const winner = variants.find(v => v.id === exp.winner_variant_id);
  if (!winner) throw new Error('Winner variant not found');

  const product = `${exp.name} — winning variant: "${winner.name}"${winner.description ? `. Copy that won: "${winner.description}"` : ''}`;

  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');

  const systemPrompt = `You are an expert performance marketing creative director. Generate conversion-ready ad variants using the AIDA and PAS frameworks, informed by A/B test winning data. Every variant must be immediately usable with correct character counts and visual direction.`;

  const userMsg = `Generate 4 ad variants for these platforms: ${platforms.join(', ')}.

Campaign objective: ${objective}
Product/context: ${product}
The winning copy has already proved it converts — build on its angle and language.

For each variant: headline (with char count), body (with char count), CTA, visual direction, A/B hypothesis.`;

  const upstream = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 4000, system: systemPrompt, messages: [{ role: 'user', content: userMsg }] }),
    signal: AbortSignal.timeout(45000),
  });

  const data = await upstream.json().catch(() => ({}));
  if (!upstream.ok) throw new Error(data.error?.message || `Anthropic error ${upstream.status}`);

  return `**Ad variants from winning experiment "${exp.name}"**\nWinner: "${winner.name}"\nPlatforms: ${platforms.join(', ')}\n\n---\n\n${data.content?.[0]?.text || ''}`;
}

// ── Tool definitions (schema for MCP clients) ──────────────────────────────
const TOOLS = [
  {
    name: 'list_experiments',
    description: 'List all A/B experiments with their status and basic metadata. Shows active, paused, finished, and draft experiments.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_experiment_stats',
    description: 'Get full performance statistics for one experiment: visitors, conversions, CVR, uplift %, and statistical significance per variant.',
    inputSchema: {
      type: 'object',
      properties: { experiment_id: { type: 'string', description: 'The experiment UUID' } },
      required: ['experiment_id'],
    },
  },
  {
    name: 'create_experiment',
    description: 'Create a new A/B experiment. Returns the experiment ID needed for subsequent calls.',
    inputSchema: {
      type: 'object',
      properties: {
        name:        { type: 'string',  description: 'Experiment name, e.g. "Homepage hero CTA test"' },
        description: { type: 'string',  description: 'What hypothesis is being tested' },
        type:        { type: 'string',  enum: ['ab', 'multivariate', 'split-url'], description: 'Experiment type (default: ab)' },
      },
      required: ['name'],
    },
  },
  {
    name: 'add_variant',
    description: 'Add a variant (or control) to an experiment. Call once per variant.',
    inputSchema: {
      type: 'object',
      properties: {
        experiment_id:      { type: 'string',  description: 'Experiment UUID' },
        name:               { type: 'string',  description: 'Variant name, e.g. "Control", "Variant B: Pain hook"' },
        description:        { type: 'string',  description: 'The copy or change being tested in this variant' },
        is_control:         { type: 'boolean', description: 'True if this is the control/baseline (default: false)' },
        traffic_allocation: { type: 'number',  description: 'Percentage of traffic (0-100, default: 50)' },
        redirect_url:       { type: 'string',  description: 'For split-URL tests: the URL to redirect to' },
      },
      required: ['experiment_id', 'name'],
    },
  },
  {
    name: 'update_experiment',
    description: 'Update experiment metadata or change its status (draft → active → paused → finished).',
    inputSchema: {
      type: 'object',
      properties: {
        experiment_id: { type: 'string', description: 'Experiment UUID' },
        status:        { type: 'string', enum: ['draft','active','paused','finished'], description: 'New status' },
        name:          { type: 'string', description: 'New name (optional)' },
        description:   { type: 'string', description: 'New description (optional)' },
        start_date:    { type: 'string', description: 'ISO 8601 start date (optional)' },
        end_date:      { type: 'string', description: 'ISO 8601 end date (optional)' },
      },
      required: ['experiment_id'],
    },
  },
  {
    name: 'declare_winner',
    description: 'Mark a variant as the winner, close the experiment (status → finished), and optionally record the reason.',
    inputSchema: {
      type: 'object',
      properties: {
        experiment_id: { type: 'string', description: 'Experiment UUID' },
        variant_id:    { type: 'string', description: 'UUID of the winning variant' },
        reason:        { type: 'string', description: 'Why this variant won (optional, e.g. "+14% CVR, p=0.02)")' },
      },
      required: ['experiment_id', 'variant_id'],
    },
  },
  {
    name: 'create_goal',
    description: 'Add a conversion goal to an experiment. Supports click, pageview, and custom goal types.',
    inputSchema: {
      type: 'object',
      properties: {
        experiment_id: { type: 'string',  description: 'Experiment UUID' },
        name:          { type: 'string',  description: 'Goal name, e.g. "CTA click", "Thank you page"' },
        type:          { type: 'string',  enum: ['click','pageview','custom','revenue'], description: 'Goal type (default: click)' },
        selector:      { type: 'string',  description: 'CSS selector for click goals, e.g. "#cta-button"' },
        url_pattern:   { type: 'string',  description: 'URL substring for pageview goals, e.g. "/thank-you"' },
        is_primary:    { type: 'boolean', description: 'Set as the primary metric for this experiment (default: false)' },
      },
      required: ['experiment_id', 'name'],
    },
  },
  {
    name: 'get_winning_copy',
    description: 'Return all winning copy from finished experiments. Use this to inform new ad creative — pass results to generate_ads_from_winner.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'generate_tracking_snippet',
    description: 'Generate the JavaScript tracking snippet for an experiment. Paste into the <head> of every page in the test. Auto-assigns visitors to variants and tracks conversions.',
    inputSchema: {
      type: 'object',
      properties: { experiment_id: { type: 'string', description: 'Experiment UUID' } },
      required: ['experiment_id'],
    },
  },
  {
    name: 'generate_ads_from_winner',
    description: 'Ad creative loop: takes the winning variant from an experiment and uses it to generate new ad variants via Claude. Closes the loop between what converts on your site and new paid media.',
    inputSchema: {
      type: 'object',
      properties: {
        experiment_id: { type: 'string',   description: 'Experiment UUID with a declared winner' },
        platforms:     { type: 'array',    items: { type: 'string' }, description: 'Platforms to generate for, e.g. ["Meta/Facebook","LinkedIn"]' },
        objective:     { type: 'string',   description: 'Campaign objective: Awareness | Traffic | Leads | Conversions | Retargeting' },
      },
      required: ['experiment_id'],
    },
  },
];

// ── MCP JSON-RPC dispatcher ────────────────────────────────────────────────
const TOOL_FNS = {
  list_experiments:           tool_list_experiments,
  get_experiment_stats:       tool_get_experiment_stats,
  create_experiment:          tool_create_experiment,
  add_variant:                tool_add_variant,
  update_experiment:          tool_update_experiment,
  declare_winner:             tool_declare_winner,
  create_goal:                tool_create_goal,
  get_winning_copy:           tool_get_winning_copy,
  generate_tracking_snippet:  tool_generate_tracking_snippet,
  generate_ads_from_winner:   tool_generate_ads_from_winner,
};

function jsonrpc(id, result) {
  return { jsonrpc: '2.0', id, result };
}
function jsonrpcErr(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Mcp-Session-Id');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json(jsonrpcErr(null, -32600, 'Method not allowed'));

  // Auth check
  const secret = process.env.MCP_SECRET;
  if (secret) {
    const auth = req.headers['authorization'] || '';
    if (!auth.startsWith('Bearer ') || auth.slice(7) !== secret) {
      return res.status(401).json(jsonrpcErr(null, -32600, 'Unauthorized'));
    }
  }

  const env = {
    SUPABASE_URL:              process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    ANTHROPIC_API_KEY:         process.env.ANTHROPIC_API_KEY,
    VERCEL_URL:                process.env.VERCEL_URL,
  };

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json(jsonrpcErr(null, -32603, 'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in Vercel env vars'));
  }

  const msg = req.body;
  if (!msg || msg.jsonrpc !== '2.0') {
    return res.status(400).json(jsonrpcErr(null, -32600, 'Invalid JSON-RPC 2.0 request'));
  }

  const { id, method, params } = msg;

  // ── MCP method routing ─────────────────────────────────────────────────
  if (method === 'initialize') {
    return res.json(jsonrpc(id, {
      protocolVersion: '2025-03-26',
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'aduma-ab-testing', version: '1.0.0', description: 'Audema A/B Testing & Experimentation MCP Server' },
    }));
  }

  if (method === 'notifications/initialized') {
    return res.status(204).end();
  }

  if (method === 'tools/list') {
    return res.json(jsonrpc(id, { tools: TOOLS }));
  }

  if (method === 'tools/call') {
    const { name, arguments: args = {} } = params || {};
    const fn = TOOL_FNS[name];
    if (!fn) return res.json(jsonrpcErr(id, -32601, `Unknown tool: ${name}`));

    try {
      const text = await fn(args, env);
      return res.json(jsonrpc(id, {
        content: [{ type: 'text', text: String(text) }],
        isError: false,
      }));
    } catch (err) {
      return res.json(jsonrpc(id, {
        content: [{ type: 'text', text: `Error: ${err.message}` }],
        isError: true,
      }));
    }
  }

  return res.json(jsonrpcErr(id, -32601, `Method not found: ${method}`));
};
