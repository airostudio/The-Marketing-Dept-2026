/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * SCOTTY ORCHESTRATOR — Audema - Your AI Marketing Department
 *
 * Scotty is the AI CMO. Routes tasks to specialist agents — but always runs
 * the Intelligence Layer FIRST so every execution is grounded in upstream
 * business context, competitive intelligence, and market signals.
 *
 * Architecture:
 *   IntelligenceEngine.getContextBundle()
 *     → buildScottySystemPrompt(contextBundle)
 *       → ClaudeService.streamResponse(...)
 *         → routeToAgent(detectedAgent)
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const ScottyOrchestrator = (() => {
  'use strict';

  /* ─────────────────────────────────────────────────────────────────────────
     AGENT REGISTRY
     All specialist agents Scotty can route to.
  ───────────────────────────────────────────────────────────────────────── */

  const AGENT_ROUTES = {
    content:     '/agents/content-studio-agent.html',
    seo:         '/agents/seo-agent.html',
    email:       '/agents/email-agent.html',
    sales:       '/agents/sales-agent.html',
    ads:         '/agents/ads-agent.html',
    social:      '/agents/social-agent.html',
    analytics:   '/agents/analytics-agent.html',
    competitive: '/agents/competitive-agent.html',
    video:       '/agents/video-agent.html',
    cro:         '/agents/cro-agent.html',
    compliance:  '/agents/compliance-agent.html',
    deck:        '/agents/deck-agent.html',
    linkedin:    '/agents/linkedin-agent.html',
  };

  const AGENT_DESCRIPTIONS = {
    content:     'Content Studio — blog posts, copy, brand voice at scale',
    seo:         'SEO Intelligence — rankings, keywords, technical audits',
    email:       'Email Engine — Klaviyo-style flows, sequences, campaigns',
    sales:       'Sales Intelligence — Apollo-style prospecting and outreach',
    ads:         'Ad Creative Lab — ad variants, A/B tests, platform-specific creative',
    social:      'Social Studio — platform-native posts, content calendar',
    analytics:   'Analytics Brain — attribution, MMM, performance reporting',
    competitive: 'Competitive Intelligence — competitor monitoring, battlecards',
    video:       'Video Studio — scripts, editing guides, thumbnail strategy',
    cro:         'CRO Lab — conversion optimization, A/B test design',
    compliance:  'Compliance Guard — brand safety, legal review, regulatory checks',
    deck:        'Deck Maker — presentations, investor decks, pitch structures',
    linkedin:    'LinkedIn Outreach — personalized connection and outreach sequences',
  };

  const HUB_URL    = '/hub.html';
  const SCOTTY_URL = '/scotty.html';

  /* ─────────────────────────────────────────────────────────────────────────
     INTELLIGENCE LAYER INTEGRATION
     Every Scotty prompt is grounded in upstream context.
  ───────────────────────────────────────────────────────────────────────── */

  /**
   * Get context bundle from IntelligenceEngine.
   * Returns a safe default if the engine isn't loaded yet.
   * @returns {Object}
   */
  function getContextBundle() {
    if (window.IntelligenceEngine && typeof window.IntelligenceEngine.getContextBundle === 'function') {
      return window.IntelligenceEngine.getContextBundle();
    }
    return {
      businessContext:      null,
      competitiveLandscape: null,
      marketSignals:        null,
      isReady:              false,
      completionScore:      0,
    };
  }

  /**
   * Build the Scotty system prompt, injecting intelligence context.
   * @param {Object} contextBundle — from IntelligenceEngine.getContextBundle()
   * @returns {string}
   */
  function buildScottySystemPrompt(contextBundle = {}) {
    const agentList = Object.entries(AGENT_DESCRIPTIONS)
      .map(([k, v]) => `  - ${v}`)
      .join('\n');

    const hasContext = contextBundle.isReady;

    const contextSection = hasContext
      ? `
## YOUR UPSTREAM INTELLIGENCE CONTEXT
This is what you know about the business before responding. Use this to give strategic,
specific guidance — not generic advice.

### Business Context
${contextBundle.businessContext || 'Not yet configured.'}

### Competitive Landscape
${contextBundle.competitiveLandscape || 'No competitive data loaded yet.'}

### Market Signals (What\'s Working Right Now)
${contextBundle.marketSignals || 'No market signals recorded yet.'}
`
      : `
## INTELLIGENCE LAYER STATUS: NOT CONFIGURED
The user has not yet set up their BusinessBrain. You are operating without upstream context.
Encourage the user to configure the Intelligence Layer first at /intelligence/business-brain.html.
You can still help, but note that your recommendations will be generic until context is loaded.
`;

    return `You are Scotty, the AI CMO of this marketing platform. You are a strategic thinker, not just a task executor.

Your role:
1. Understand WHAT the user wants to achieve (the goal)
2. Apply UPSTREAM INTELLIGENCE to understand WHY now, given competitive context and market signals
3. Recommend WHICH specialist agent(s) to use and exactly what to ask them
4. Be direct, specific, and strategic — never generic

You have access to 13 specialist agents:
${agentList}

When recommending an agent, always include:
- The specific agent name and why it's the right one for this task
- What exact request the user should make to that agent
- Any strategic context they should include (from the intelligence layer)
- The direct URL to that agent page

${contextSection}

## RESPONSE FORMAT
Structure your responses as:
**Strategic Context:** [Why this matters now, given competitive and market context]
**Recommended Agent(s):** [Agent name + URL]
**What to Ask:** [Specific prompt/request for that agent]
**Pro Tip:** [One sharp strategic insight specific to this situation]

If the intelligence layer is not configured, open by recommending they set it up first, then help anyway.
Keep responses concise and actionable. You're a CMO, not a consultant who writes 5-page reports.`;
  }

  /* ─────────────────────────────────────────────────────────────────────────
     ROUTING LOGIC
     Detect agent intent from natural language.
  ───────────────────────────────────────────────────────────────────────── */

  /**
   * Detect the most relevant agent from a task description.
   * @param {string} task
   * @returns {{ agent: string, reason: string }}
   */
  function detectAgent(task) {
    const t = task.toLowerCase();

    if (/seo|keyword|rank|backlink|serp|meta|schema|technical audit|site speed/.test(t))
      return { agent: 'seo', reason: 'SEO / search intent detected' };

    if (/email|subject line|newsletter|drip|sequence|flow|open rate|klaviyo/.test(t))
      return { agent: 'email', reason: 'Email marketing intent detected' };

    if (/ad|advert|creative|paid|ppc|google ads|meta ads|facebook ad|tiktok ad|a\/b test/.test(t))
      return { agent: 'ads', reason: 'Advertising intent detected' };

    if (/instagram|tiktok|tweet|social post|caption|content calendar|reel|thread/.test(t))
      return { agent: 'social', reason: 'Social media intent detected' };

    if (/prospect|icp|outreach|sales|lead|crm|apollo|cold email|pipeline/.test(t))
      return { agent: 'sales', reason: 'Sales intelligence intent detected' };

    if (/analytics|attribution|report|dashboard|metrics|roi|cac|ltv|mmm|performance/.test(t))
      return { agent: 'analytics', reason: 'Analytics intent detected' };

    if (/competitor|competitive|crayon|rival|market share|battlecard|win.loss/.test(t))
      return { agent: 'competitive', reason: 'Competitive intelligence intent detected' };

    if (/video|script|youtube|reel|short.form|descript|tavus|podcast/.test(t))
      return { agent: 'video', reason: 'Video content intent detected' };

    if (/conversion|cro|landing page|cta|form|checkout|split test|optimiz/.test(t))
      return { agent: 'cro', reason: 'CRO intent detected' };

    if (/compliance|legal|brand safety|disclaimer|gdpr|ftc|review content/.test(t))
      return { agent: 'compliance', reason: 'Compliance review intent detected' };

    if (/deck|slide|presentation|pitch|investor|keynote|tome/.test(t))
      return { agent: 'deck', reason: 'Presentation intent detected' };

    if (/linkedin|connection request|inmail|profile|network|b2b message/.test(t))
      return { agent: 'linkedin', reason: 'LinkedIn outreach intent detected' };

    return { agent: 'content', reason: 'Default to Content Studio' };
  }

  /* ─────────────────────────────────────────────────────────────────────────
     MEMORY — Cross-agent conversation persistence
  ───────────────────────────────────────────────────────────────────────── */

  function saveMemory(agentKey, userMsg, assistantMsg) {
    const key = `scotty_memory_${agentKey}`;
    const memory = JSON.parse(localStorage.getItem(key) || '[]');
    memory.push({ role: 'user',      content: userMsg,      ts: Date.now() });
    memory.push({ role: 'assistant', content: assistantMsg, ts: Date.now() });
    if (memory.length > 20) memory.splice(0, memory.length - 20);
    localStorage.setItem(key, JSON.stringify(memory));
  }

  function getMemory(agentKey) {
    const key = `scotty_memory_${agentKey}`;
    return JSON.parse(localStorage.getItem(key) || '[]');
  }

  function clearMemory(agentKey) {
    if (agentKey) {
      localStorage.removeItem(`scotty_memory_${agentKey}`);
    } else {
      Object.keys(AGENT_ROUTES).forEach(k => localStorage.removeItem(`scotty_memory_${k}`));
    }
  }

  /* ─────────────────────────────────────────────────────────────────────────
     MAIN ASK SCOTTY FUNCTION
     The primary entry point for calling Scotty from any page.
  ───────────────────────────────────────────────────────────────────────── */

  /**
   * Ask Scotty a question and stream the response.
   * @param {Object} opts
   * @param {string}   opts.userMessage   — the user's task/question
   * @param {Array}    [opts.history]     — prior conversation turns
   * @param {Element}  [opts.outputEl]    — DOM element for streaming output
   * @param {Function} [opts.onChunk]     — called with each text chunk
   * @param {Function} [opts.onDone]      — called with full response
   * @param {Function} [opts.onError]     — called with Error
   * @returns {Promise<string>}
   */
  async function ask({ userMessage, history = [], outputEl, onChunk, onDone, onError } = {}) {
    if (!window.ClaudeService) {
      const errMsg = 'Claude API not configured. Add your API key in Settings to enable Scotty.';
      if (outputEl) outputEl.textContent = errMsg;
      if (onError) onError(new Error(errMsg));
      return errMsg;
    }

    const contextBundle = getContextBundle();
    const systemPrompt  = buildScottySystemPrompt(contextBundle);

    const messages = [
      ...history,
      { role: 'user', content: userMessage },
    ];

    return window.ClaudeService.streamResponse({
      systemPrompt,
      messages,
      outputEl,
      onChunk,
      onDone,
      onError,
    });
  }

  /* ─────────────────────────────────────────────────────────────────────────
     LEAD GENERATION ORCHESTRATION
     ALL lead gen activities MUST go through Scotty. No exceptions.
  ───────────────────────────────────────────────────────────────────────── */

  /**
   * Build a sales-specific system prompt for Scotty lead gen orchestration.
   * @param {Object} contextBundle — from IntelligenceEngine.getContextBundle()
   * @returns {string}
   */
  function buildLeadGenOrchestrationPrompt(contextBundle = {}) {
    const hasContext = contextBundle.isReady;

    const contextSection = hasContext
      ? `
## LEAD GENERATION INTELLIGENCE CONTEXT

### ICP & Buyer Profile
${contextBundle.businessContext || 'Not configured.'}

### Competitive Landscape
${contextBundle.competitiveLandscape || 'No competitive data loaded.'}

### Market Signals (Active Personalization Triggers)
${contextBundle.marketSignals || 'No market signals recorded.'}
`
      : `
## INTELLIGENCE LAYER: NOT CONFIGURED
You lack ICP firmographics, buyer journey data, and market signals.
Strongly encourage configuring BusinessBrain at /intelligence/business-brain.html.
Without this, all lead gen will be generic — not data-driven.
`;

    return `You are Scotty, the AI CMO. You are the MANDATORY orchestrator for ALL lead generation.

No lead generation strategy may be executed without your strategic brief first.

Your lead gen mandate:
1. Define ICP qualification criteria (A/B/C tier scoring) based on firmographics
2. Map buyer journey stages (awareness/consideration/decision) to multi-touch cadence timing
3. Extract pain-specific hooks from ICP pain points — never use generic openers
4. Build competitive displacement angles from CompetitiveRadar data
5. Create outreach urgency from MarketPulse signals
6. Define A/B test variants for subject lines and opening messages
7. Recommend prospect enrichment signals (hiring, funding, tech stack signals)

CRITICAL RULES:
- Every strategy MUST use ICP firmographics for prospect qualification
- Every cadence MUST map to the buyer journey stage (awareness/consideration/decision)
- Pain points MUST be ICP-specific, never generic ("most [role]s at [size] companies struggle with...")
- At least one competitive angle MUST be included when competitor data is available
- Always include prospect qualification scoring (A/B/C tier)
- Timing recommendations must be specific (Day 0, Day 3, Day 7, etc.)

${contextSection}

## SCOTTY'S LEAD GEN BRIEF FORMAT

Structure every response exactly as follows:

**🎯 Strategic Context**
[Why this lead gen initiative matters NOW — competitive context, market signals, timing]

**📋 ICP Qualification Criteria**
- **A-Tier (High Priority):** [Firmographic + 2+ intent signal criteria — prioritise 80% effort here]
- **B-Tier (Medium Priority):** [Firmographic match + 1 intent signal]
- **C-Tier (Low Priority):** [Partial ICP match — cold outreach only]

**🎣 Top 5 Outreach Hooks**
[Pain-specific hooks drawn from ICP pain points — never generic, use [variables] for personalisation]

**📅 Multi-Touch Cadence Map**
[Timing by buyer journey stage: awareness / consideration / decision, with channel + content type per touch]

**🥊 Competitive Displacement Angles**
[Specific messaging vs. top 1-2 competitors — what we do that they can't]

**⚡ A/B Test Variants**
Subject A: [variant]
Subject B: [variant]
Opening A: [variant]
Opening B: [variant]

**📊 Expected Pipeline Impact**
[Qualified pipeline increase estimate based on ICP precision — target 30-50% uplift]

Be specific, data-driven, and strategic. No generic advice.`;
  }

  /**
   * Orchestrate ALL lead generation through Scotty.
   * This is the MANDATORY entry point for any lead gen activity.
   *
   * @param {Object} opts
   * @param {string}   opts.task        — the lead gen task description
   * @param {Array}    [opts.history]   — prior conversation turns
   * @param {Element}  [opts.outputEl]  — DOM element for streaming output
   * @param {Function} [opts.onChunk]   — called with each text chunk
   * @param {Function} [opts.onDone]    — called with full response when complete
   * @param {Function} [opts.onError]   — called with Error on failure
   * @returns {Promise<string>}
   */
  async function orchestrateLeadGen({ task, history = [], outputEl, onChunk, onDone, onError } = {}) {
    if (!window.ClaudeService) {
      const err = 'Claude API not configured. Add your API key in Settings to enable Scotty.';
      if (outputEl) outputEl.textContent = err;
      if (onError) onError(new Error(err));
      return err;
    }

    const contextBundle = getContextBundle();
    const systemPrompt  = buildLeadGenOrchestrationPrompt(contextBundle);
    const messages      = [...history, { role: 'user', content: task }];

    return window.ClaudeService.streamResponse({
      systemPrompt,
      messages,
      outputEl,
      onChunk,
      onDone,
      onError,
    });
  }

  /**
   * Write ICP export data to localStorage for cross-page use.
   * Called by Sales Agent after building a strategy — shares ICP criteria
   * with LinkedIn Prospecting so prospects can be scored automatically.
   * @param {Object} icpExport
   */
  function exportICPToProspecting(icpExport) {
    try {
      localStorage.setItem('scotty_lead_gen_icp_export', JSON.stringify({
        ...icpExport,
        exportedAt: new Date().toISOString(),
      }));
    } catch (e) {
      console.warn('[ScottyOrchestrator] exportICPToProspecting failed:', e);
    }
  }

  /**
   * Read ICP export from localStorage — used by LinkedIn Prospecting to score prospects.
   * @returns {Object|null}
   */
  function getICPExport() {
    try {
      const raw = localStorage.getItem('scotty_lead_gen_icp_export');
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  /* ─────────────────────────────────────────────────────────────────────────
     NAVIGATION HELPERS
  ───────────────────────────────────────────────────────────────────────── */

  function goToScotty() { window.location.href = SCOTTY_URL; }
  function goToHub()    { window.location.href = HUB_URL;    }

  function routeToAgent(agentKey) {
    const url = AGENT_ROUTES[agentKey];
    if (!url) { console.warn(`ScottyOrchestrator: unknown agent "${agentKey}"`); return; }
    window.location.href = url;
  }

  /** Wire data-scotty attributes on any page */
  function wireButtons() {
    document.querySelectorAll('[data-scotty="ask"]').forEach(el => {
      el.addEventListener('click', goToScotty);
    });
    document.querySelectorAll('[data-scotty="hub"]').forEach(el => {
      el.addEventListener('click', goToHub);
    });
    document.querySelectorAll('[data-scotty-route]').forEach(el => {
      el.addEventListener('click', () => routeToAgent(el.dataset.scottyRoute));
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wireButtons);
  } else {
    wireButtons();
  }

  return {
    ask,
    goToScotty,
    goToHub,
    routeToAgent,
    detectAgent,
    saveMemory,
    getMemory,
    clearMemory,
    getContextBundle,
    buildScottySystemPrompt,
    // Lead Gen Orchestration — ALL lead gen must go through Scotty
    orchestrateLeadGen,
    buildLeadGenOrchestrationPrompt,
    exportICPToProspecting,
    getICPExport,
    AGENT_ROUTES,
    AGENT_DESCRIPTIONS,
  };
})();

window.ScottyOrchestrator = ScottyOrchestrator;
