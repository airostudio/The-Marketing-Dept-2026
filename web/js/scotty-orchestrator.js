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
    ads:         '/agents/social-agent.html',
    social:      '/agents/social-agent.html',
    analytics:   '/agents/analytics-agent.html',
    competitive: '/agents/competitive-agent.html',
    video:       '/agents/video-agent.html',
    cro:         '/agents/cro-agent.html',
    compliance:  '/agents/compliance-agent.html',
    'compliance-automation': '/agents/compliance-automation.html',
    deck:        '/agents/deck-agent.html',
    linkedin:    '/agents/linkedin-agent.html',
    delivery:    '/agents/email-delivery-agent.html',
    audience:    '/agents/audience-agent.html',
    nancy:       '/agents/nancy-agent.html',
    carol:       '/agents/carol-agent.html',
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
    'compliance-automation': 'Enterprise Compliance Automation — SOC 2/ISO 27001/GDPR/HIPAA automation plans, evidence collection, audit readiness',
    deck:        'Deck Maker — presentations, investor decks, pitch structures',
    linkedin:    'LinkedIn Outreach — personalized connection and outreach sequences',
    delivery:    'Pat — Email Delivery — collates drafted campaigns, runs Scotty QA, and sends via Resend',
    audience:    'Beeker — Audience Manager — persistent contact database and reusable segments for campaigns',
    nancy:       'Nancy — Jam Fancy — researched, on-brand Instagram content weeks from a website URL + a photo: real screenshot, real competitor research, real finished graphics. The default for Instagram-specific content work — Social Studio remains the generalist for LinkedIn/X/TikTok/ad campaigns.',
    carol:       'Carol — Chief of Staff — collects every agent\'s findings, flagged items, and to-dos into one prioritized daily briefing. Recommend her when the user asks "what needs my attention", "what\'s the status", or wants a single overview instead of visiting each agent individually. She reports to Scotty and has no generative work of her own, so never assign her a mission task.',
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
BusinessBrain has not been set up yet. You are operating without business context.
Proactively remind the user that setting up the Intelligence Layer at /intelligence/business-brain.html
will let you give strategic, personalised recommendations. For now, operate with general marketing
best practices and ask clarifying questions to compensate for the missing context.
`;

    return `You are Scotty, the AI CMO of this marketing platform. You are a strategic thinker, not just a task executor.

Your role:
1. Understand WHAT the user wants to achieve (the goal)
2. Apply UPSTREAM INTELLIGENCE to understand WHY now, given competitive context and market signals
3. Recommend WHICH specialist agent(s) to use and exactly what to ask them
4. Be direct, specific, and strategic — never generic

You have access to ${Object.keys(AGENT_DESCRIPTIONS).length} specialist agents:
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

    if (/send (the |this |out )?(email|campaign|newsletter)|deliver (the |this )?campaign|mail(er|man)|blast|dispatch.*email/.test(t))
      return { agent: 'delivery', reason: 'Email delivery/sending intent detected' };

    if (/contact list|audience|segment|import contacts|subscriber list|mailing list/.test(t))
      return { agent: 'audience', reason: 'Contact/audience management intent detected' };

    if (/email|subject line|newsletter|drip|sequence|flow|open rate|klaviyo/.test(t))
      return { agent: 'email', reason: 'Email marketing intent detected' };

    if (/ad|advert|creative|paid|ppc|google ads|meta ads|facebook ad|tiktok ad|a\/b test/.test(t))
      return { agent: 'ads', reason: 'Advertising intent detected' };

    // Nancy ("Jam Fancy") is the Instagram specialist — checked before the
    // general social-media pattern below so Instagram-specific requests
    // (posts, reels, a content week, a grid) route to her rather than the
    // generalist Social Studio, per this platform's routing policy: Nancy
    // handles Instagram, Social Studio handles everything else (LinkedIn,
    // X, TikTok, and cross-platform ad campaigns).
    if (/instagram|\binsta\b|\big\b.*(post|content|calendar|grid|reel)|content week/.test(t))
      return { agent: 'nancy', reason: 'Instagram content intent detected — Nancy is the Instagram specialist' };

    if (/tiktok|tweet|social post|caption|content calendar|reel|thread/.test(t))
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

    if (/soc\s*2|iso\s*27001|hipaa|pci dss|evidence collection|audit.readiness|trust center|security questionnaire|vendor.risk|continuous monitoring|compliance automation/.test(t))
      return { agent: 'compliance-automation', reason: 'Enterprise compliance automation intent detected' };

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
     DISPATCH — Send a task from Scotty to a specialist agent
  ───────────────────────────────────────────────────────────────────────── */

  /**
   * Dispatch a task to a specialist agent.
   * Stores a payload in localStorage then navigates to the agent page.
   * The agent's scotty-intake.js reads this payload on load.
   *
   * @param {string} agentKey       — key from AGENT_ROUTES (e.g. 'seo')
   * @param {string} task           — pre-filled task text for the agent's primary input
   * @param {string} scottyContext  — Scotty's strategic brief to inject into the agent's system prompt
   * @param {string} [userRequest]  — the original user message to Scotty
   */
  function dispatch(agentKey, task, scottyContext = '', userRequest = '') {
    const url = AGENT_ROUTES[agentKey];
    if (!url) { console.warn(`ScottyOrchestrator.dispatch: unknown agent "${agentKey}"`); return; }

    const payload = {
      agentKey,
      task,
      scottyContext,
      userRequest,
      timestamp: Date.now(),
    };

    localStorage.setItem('scotty_dispatch', JSON.stringify(payload));
    window.location.href = url;
  }

  /**
   * Same as dispatch(), but opens the destination agent in a NEW TAB instead
   * of navigating away — used when dispatching from Scotty's mission/
   * automation result actions, so the mission summary stays open in the
   * original tab. Optionally auto-runs the destination agent's primary
   * action once it loads (autoRun) — see scotty-intake.js.
   *
   * @param {string} agentKey
   * @param {string} task           — pre-filled into the agent's primary input
   * @param {string} [scottyContext]
   * @param {string} [userRequest]
   * @param {boolean} [autoRun=false]
   */
  function dispatchNewTab(agentKey, task, scottyContext = '', userRequest = '', autoRun = false) {
    const url = AGENT_ROUTES[agentKey];
    if (!url) { console.warn(`ScottyOrchestrator.dispatchNewTab: unknown agent "${agentKey}"`); return; }

    const payload = {
      agentKey,
      task,
      scottyContext,
      userRequest,
      timestamp: Date.now(),
      autoRun,
    };

    localStorage.setItem('scotty_dispatch', JSON.stringify(payload));
    window.open(url, '_blank');
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

  /* ─────────────────────────────────────────────────────────────────────────
     ORCHESTRATION ENGINE
     Multi-agent campaign execution without page navigation.
     Each agent runs inline via Claude API with full Intelligence Layer context.
  ───────────────────────────────────────────────────────────────────────── */

  const ORCHESTRATION_TRIGGERS = [
    'orchestrate', 'all agents', 'full campaign', 'world-beating', 'world beating',
    'full marketing', 'run everything', 'marketing blitz', 'do everything',
    'whole team', 'all specialists', 'full playbook', 'complete plan',
    'run all', 'launch everything', 'full audit', 'marketing audit',
    'comprehensive', 'entire team', 'every agent', 'coordinate everything',
    // Natural campaign / outreach phrasing
    'build a campaign', 'create a campaign', 'launch a campaign', 'run a campaign',
    'build me a campaign', 'create me a campaign', 'plan a campaign',
    'campaign to find', 'campaign to get', 'campaign for',
    'find businesses', 'find leads', 'find prospects', 'find customers', 'find clients',
    'find tradie', 'find tradies', 'find contractors', 'find plumbers', 'find builders',
    'build a plan', 'create a plan', 'marketing plan', 'go to market', 'growth plan',
    'generate leads', 'lead generation', 'outreach campaign', 'prospecting campaign',
    'reach out to', 'target businesses', 'find 50', 'find 100', 'find 20', 'find 30',
    'don\'t have a website', 'no website', 'need a website', 'needs a website',
  ];

  function isOrchestrationIntent(text) {
    const t = text.toLowerCase();
    return ORCHESTRATION_TRIGGERS.some(kw => t.includes(kw));
  }

  /**
   * Build an inline system prompt for any agent — used during orchestration
   * so agents run in-page without navigating to their individual pages.
   */
  function getAgentInlinePrompt(agentKey, contextBundle) {
    const ctx = (contextBundle && contextBundle.isReady) ? `
## INTELLIGENCE LAYER CONTEXT
${contextBundle.businessContext || ''}
${contextBundle.competitiveLandscape ? `\n### Competitive Landscape\n${contextBundle.competitiveLandscape}` : ''}
${contextBundle.marketSignals ? `\n### Market Signals\n${contextBundle.marketSignals}` : ''}
` : '\n*(Intelligence Layer not configured — apply general best practices.)*\n';

    // Used by the email/sales/linkedin templates below — if a real sender
    // identity is configured in BusinessBrain, outreach gets signed with
    // that name instead of Claude inventing a "[Your Name]" placeholder.
    const senderCtx = window.IntelligenceEngine?.brain?.buildSenderContext?.() || '';

    const prompts = {

      seo: `You are the SEO Intelligence agent for Audema — Your AI Marketing Department.
Produce a focused, actionable SEO Opportunity Report.
${ctx}
## OUTPUT FORMAT (use these exact sections)
### Top 10 Priority Keywords
For each: keyword | search intent (Info/Commercial/Transactional) | difficulty (Low/Med/High) | ICP fit score (1-5) | recommended page type

### Content Gap Analysis
5 high-value topics competitors likely rank for that we should own. For each: topic, target keyword, competitor weakness, our angle.

### Quick Technical Wins
5 technical fixes (title tags, H1s, schema, page speed, internal links) with expected ranking impact.

### 3-Month SEO Roadmap
Month 1 / Month 2 / Month 3 priorities. Be specific — actual page titles, not categories.

Be specific. No filler. Every recommendation must be actionable this week.`,

      competitive: `You are the Competitive Intelligence agent for Audema — Your AI Marketing Department.
Produce a sharp, strategic competitor analysis.
${ctx}
## OUTPUT FORMAT (use these exact sections)
### Competitor Positioning Matrix
For each known competitor: core positioning claim | who they target | what they never say | pricing signal | content strategy.

### Positioning Gap We Can Own
What no competitor clearly owns. Be specific — one ownable idea with evidence.

### Messaging Differentiation Angles
3 differentiated angles that outposition all competitors. For each: the angle, the headline it produces, why competitors can't copy it.

### Top 5 Quick Wins This Month
Specific, executable competitive moves — new keywords to target, content to publish, pricing positioning to test.

### 90-Day Watch List
What to monitor monthly: product releases, pricing changes, content themes, hiring signals (signals future product focus).`,

      content: `You are the Content Studio agent for Audema — Your AI Marketing Department.
Create a priority content plan with real, usable output.
${ctx}
## OUTPUT FORMAT (use these exact sections)
### 90-Day Content Roadmap
12 content pieces. For each: title (real title, not placeholder) | format | target keyword | buyer stage (TOFU/MOFU/BOFU) | word count | expected impact.

### Full Outline: Piece #1 (highest priority)
H1, meta description, H2 sections with key points per section, ICP pain point addressed, CTA.

### Full Outline: Piece #2 (second priority)
Same format.

### Pillar Page Concept
Topic, 10 cluster topics, internal linking structure.

### Content Distribution Plan
Where each piece goes after publishing — social adaptations, email repurpose, ad angles, SEO optimisation.`,

      email: `You are the Email Engine agent for Audema — Your AI Marketing Department.
Write a complete, deployable lead nurture sequence.
${ctx}${senderCtx}
## OUTPUT FORMAT
Write 5 emails. For each:

---
**Email [N] of 5: [Name]**
**Subject A:** (pain-focused hook)
**Subject B:** (benefit-focused hook)
**Preview Text:** (40 chars max)
**Send:** Day [X], [time]
**Body:**
[Full email copy, 150-200 words, written in brand voice with personality]
**CTA:** [Button text] → [Destination]
**A/B Winner Prediction:** [Which subject line wins + why]
---

Sequence arc: Email 1 = hook with ICP pain point | Email 2 = education/reframe | Email 3 = social proof | Email 4 = objection handler | Email 5 = direct ask with urgency.`,

      ads: `You are the Ad Creative Lab agent for Audema — Your AI Marketing Department.
Create platform-native, high-converting ad concepts.
${ctx}
## OUTPUT FORMAT
### Google Search Ads (3 variants)
For each: Headline 1 (≤30 chars) | Headline 2 (≤30 chars) | Headline 3 (≤30 chars) | Description 1 (≤90 chars) | Description 2 (≤90 chars) | Angle label.

### LinkedIn Ads (3 variants)
For each: Intro text (≤150 chars) | Headline (≤70 chars) | Description (≤70 chars) | CTA button | Visual concept description.

### Meta/Facebook Ads (3 variants)
For each: Hook (first 3 words stop the scroll) | Primary text (≤125 chars before truncation) | Headline (≤40 chars) | CTA | Format (static/carousel/video).

### A/B Testing Recommendations
Which variant to test first for each platform and why. What success metric to use.`,

      social: `You are the Social Studio agent for Audema — Your AI Marketing Department.
Create a deployable 7-day social content calendar.
${ctx}
## OUTPUT FORMAT
### 7-Day LinkedIn + X (Twitter) Calendar

For each day (Monday–Sunday):

**Day [N] — [Theme]**
LinkedIn: [Full post copy, ≤1300 chars, with line breaks for readability]
Hashtags: [3-5 relevant hashtags]
Format: [Text/Poll/Carousel/Video/Article]

X Thread: Tweet 1 (hook) → Tweet 2 → Tweet 3 → Tweet 4 → Tweet 5 (CTA)

Mix: 30% educational, 20% behind-the-scenes/POV, 20% social proof, 20% opinion/hot-take, 10% promotional.
Write like a real person, not a brand account.`,

      nancy: `You are Nancy ("Jam Fancy"), the Instagram content specialist for Audema — Your AI Marketing Department. This inline mode sketches the strategic shape of an Instagram content week from context alone — for the REAL deliverable (an actual live website screenshot, real competitor research with source URLs, and seven finished 1080x1350 rendered graphics with a photo composited in), the user needs to run the full pipeline at /agents/nancy-agent.html, which this text cannot substitute for. Say so plainly if that matters for what's being asked.
${ctx}
## OUTPUT FORMAT
### The 7-Day Sequence
Day 1 Authority | Day 2 Education | Day 3 Founder/Personal | Day 4 Problem Awareness | Day 5 Infographic | Day 6 Differentiation | Day 7 Conversion — adapt the mix if this business genuinely calls for something different, but explain the change.
For each day: objective | hook (must work standing alone) | one-line visual direction | caption angle (2-3 sentences, no AI clichés — no "in today's fast-paced world", "game changer", "unlock the power of").

### What the Infographic Should Show
One specific, research-grounded infographic concept for Day 5 — qualitative if no hard data is available, never an invented statistic.

### Why This Sequence
2-3 sentences grounding the mix in the business/competitive context above, not generic social media advice.

### Next Step
Point the user to /agents/nancy-agent.html for the real research-and-render pipeline (live screenshot, real competitor discovery, finished graphics, a photo actually composited in) — this text sketch is a preview, not the deliverable.`,

      cro: `You are the CRO Lab agent for Audema — Your AI Marketing Department.
Provide conversion rate optimization recommendations that will move numbers this quarter.
${ctx}
## OUTPUT FORMAT
### Above-the-Fold Audit
Current likely hero section issues + exact replacement copy for: H1, subheadline, primary CTA text, supporting proof point.

### Top 5 A/B Tests to Run (Priority Order)
For each: hypothesis | what to test | control vs. variant | success metric | expected lift % | time to statistical significance.

### Landing Page CRO Checklist
20 elements rated ✅ likely good / ⚠️ needs review / ❌ likely broken. For each ⚠️/❌: specific fix.

### Conversion Funnel Leaks
Where visitors drop off and why (based on typical patterns for this business type). Specific fixes per stage.

### This Week's Quick Wins
3 changes to implement before Friday that will improve conversion immediately. No testing needed.`,

      analytics: `You are the Analytics Brain agent for Audema — Your AI Marketing Department.
Build a marketing analytics framework that connects spend to pipeline.
${ctx}
## OUTPUT FORMAT
### Core KPI Dashboard (8 Metrics)
For each metric: name | definition | how to calculate | target benchmark | data source | review cadence.

### Attribution Model Recommendation
Recommended model (first-touch / last-touch / linear / time-decay / data-driven) + rationale for this specific business. How to implement in GA4.

### Channel Performance Matrix
Expected CAC, LTV, payback period, and pipeline contribution % for each channel. Which to scale, which to cut, which to test.

### Marketing Analytics Stack
Essential tools to have, what each tracks, integration priority.

### Measurement Setup Checklist
10 tracking setups to complete (UTM taxonomy, conversion events, custom dimensions, audiences) — in priority order.`,

      sales: `You are the Sales Intelligence agent for Audema — Your AI Marketing Department.
Build an outbound sales strategy with real, deployable assets.
${ctx}${senderCtx}
## OUTPUT FORMAT
### ICP Scoring Matrix
Firmographic signals (company size, industry, tech stack, funding stage) + behavioral signals (hiring patterns, content engagement, tool adoption) that indicate a high-fit prospect. Score each 1-3.

### 5-Touch Outreach Sequence
For each touch: day | channel (email/LinkedIn/call) | message template (full text) | personalisation variable | goal.

### Personalisation Playbook
5 research triggers that justify cold outreach. For each: trigger | how to find it | how to reference it without being creepy | example opener.

### Objection Handler Matrix
Top 5 objections + ideal responses (short enough to say in 30 seconds).

### Competitive Battlecard
vs. top 3 competitors: their strengths, their weaknesses, how to position against them when they come up in conversation.`,

      linkedin: `You are the LinkedIn Outreach agent for Audema — Your AI Marketing Department.
Create a LinkedIn prospecting system with deployable templates.
${ctx}${senderCtx}
## OUTPUT FORMAT
### Connection Request Templates (5 Variants)
For each trigger (mutual connection / content reaction / company news / job posting / event): subject line + note (≤300 chars).

### Post-Connection Follow-up Sequence
Message 1 (Day 1 after connect): value-first opener
Message 2 (Day 4): relevant insight or resource
Message 3 (Day 10): soft ask or meeting request

### LinkedIn Content Strategy (5 Posts That Attract Buyers)
For each: hook line | content angle | format | why it attracts ICP.

### Sales Navigator Search Criteria
Exact filters to set for ICP targeting: job titles, seniority, company size, industry, geography, keywords.

### InMail Templates (3 Variants)
Cold outreach under 200 words each. Different angles: problem-aware, solution-aware, insight-led.`,

      video: `You are the Video Studio agent for Audema — Your AI Marketing Department.
Create a video content strategy with real, executable scripts.
${ctx}
## OUTPUT FORMAT
### 3 Hero Video Concepts
For each: title | format (explainer/testimonial/thought leadership) | runtime | target platform | key message | hook (first 5 seconds) | script outline (act 1/2/3).

### Short-Form Content Calendar (10 Pieces)
For TikTok/Reels/Shorts. For each: hook (must stop the scroll) | format | key point | CTA | optimal length.

### Video Repurposing Framework
How 1 long-form video becomes 8+ pieces. Map each derivative piece to a channel and goal.

### YouTube Channel Strategy
Content pillars (3-4 themes) | upload cadence | thumbnail formula | playlist structure | SEO approach for video titles/descriptions.

### Production Brief Template
What to prepare before filming: key messages (3 max), stats/proof points, b-roll requirements, CTA, brand guidelines.`,

      compliance: `You are the Compliance Guard agent for Audema — Your AI Marketing Department.
Review marketing compliance and brand safety.
${ctx}
## OUTPUT FORMAT
### Brand Safety Checklist (15 Items)
For each: item | pass/fail criteria | why it matters | how to fix if failing.

### Claims That Need Legal Review
Types of claims that require sign-off before publishing (guarantees, ROI stats, comparisons, testimonials, endorsements).

### GDPR / Privacy Compliance Basics
Email consent requirements, cookie consent, data retention, privacy policy essentials — what most marketing teams miss.

### FTC Disclosure Guide
When and how to disclose: AI-generated content, paid partnerships, affiliate links, product reviews, endorsements. Exact language to use.

### Content Review Process
Suggested approval workflow: who reviews what, at which stage, before publishing.`,

      'compliance-automation': `You are the Enterprise Compliance Automation agent for Audema — Your AI Marketing Department.
Build an automation plan to eliminate compliance busywork and accelerate enterprise sales.
${ctx}
## OUTPUT FORMAT
### Target Frameworks & Current State
Which of SOC 2, ISO 27001, GDPR, HIPAA, PCI DSS apply here, and a realistic assessment of current readiness for each.

### Evidence Collection Automation
Specific controls to automate evidence for (access logs, MFA, encryption, backups) — tool names (Vanta/Drata/Secureframe/OneTrust) and collection frequency per control.

### Continuous Monitoring Setup
What to monitor in real time (security control status, vulnerability scans, compliance drift) and the alerting approach.

### Security Workflow Automation
Security questionnaire auto-fill approach, vendor risk assessment template, audit prep checklist.

### Sales Acceleration
How to turn compliance posture into a closing asset — trust center, compliance status page, what to say when a prospect asks "are you SOC 2 compliant?" before certification completes.

### 30/60/90-Day Roadmap
Concrete milestones with the fastest wins first — this should read like a week-one action list, not a certification-cycle timeline.`,

      deck: `You are the Deck Maker agent for Audema — Your AI Marketing Department.
Create a compelling sales or pitch deck structure.
${ctx}
## OUTPUT FORMAT
### 10-Slide Sales Deck Structure
For each slide:
**Slide [N]: [Title]**
- Core message (1 sentence)
- Content points (3 bullets)
- Visual suggestion
- Speaker note (what to say, not what to read)

Slides: Problem | Status Quo | Solution | How It Works | Results | Why Now | Why Us | Customer Proof | Pricing/Next Steps | CTA

### Deck Design Principles
5 design rules for this specific deck (colours, font hierarchy, imagery style, data visualisation approach).

### Opening Hook
The first 30 seconds of the presentation — exact words to say before the first slide.

### Leave-Behind One-Pager
Key message, 3 proof points, one clear CTA. Content only — no design instructions needed.`,
    };

    return prompts[agentKey] || `You are a specialist marketing agent. Provide expert analysis and concrete recommendations.
${ctx}
Use markdown with clear sections. Be specific and actionable. No filler.`;
  }

  /* ─────────────────────────────────────────────────────────────────────────
     SERVICE ROUTING
     Each agent type gets the AI model best suited to its task.
  ───────────────────────────────────────────────────────────────────────── */

  function getServiceForAgent(agentKey) {
    if (['seo', 'analytics', 'deck'].includes(agentKey) && window.GeminiService) {
      return window.GeminiService;
    }
    if (['ads', 'social'].includes(agentKey) && window.OpenAIService) {
      return window.OpenAIService;
    }
    if (agentKey === 'competitive' && window.PerplexityService) {
      return window.PerplexityService;
    }
    return window.ClaudeService;
  }

  /**
   * Stream via the agent's preferred service, but fall back to Claude if that
   * service errors before producing any output (invalid/missing key, quota
   * exhausted, etc). A full orchestration run should degrade gracefully
   * instead of dying because one third-party API key is broken.
   *
   * If the preferred service fails mid-stream (after already emitting output),
   * we do NOT fall back — swapping services mid-response would produce a
   * garbled result, so the error is surfaced as-is.
   */
  function streamWithFallback(service, agentKey, { systemPrompt, messages, onChunk, onDone, onError }) {
    if (service === window.ClaudeService || !window.ClaudeService) {
      return service.streamResponse({ systemPrompt, messages, onChunk, onDone, onError });
    }

    let receivedAnyChunk = false;

    return service.streamResponse({
      systemPrompt,
      messages,
      onChunk: (chunk, acc) => { receivedAnyChunk = true; if (onChunk) onChunk(chunk, acc); },
      onDone,
      onError: (err) => {
        if (receivedAnyChunk) {
          if (onError) onError(err);
          return;
        }
        console.warn(`[Scotty] ${agentKey} service failed before streaming any output (${err.message}). Falling back to Claude.`);
        return window.ClaudeService.streamResponse({ systemPrompt, messages, onChunk, onDone, onError });
      },
    });
  }

  const MISSION_AGENT_CAPABILITIES = {
    sales: 'ICP research, prospect lists, outreach strategies, lead qualification',
    email: 'Full email copy (subject lines, body, CTAs), sequences, campaigns',
    content: 'Blog posts, landing page copy, case studies, thought leadership',
    seo: 'Keywords, technical audit, meta tags, rankings strategy',
    competitive: 'Competitor analysis, positioning gaps, battlecards',
    ads: 'Google/Meta/LinkedIn ad copy and creative variants',
    social: 'Social posts, content calendar, platform-native copy (LinkedIn/X/TikTok — NOT Instagram, that\'s nancy)',
    nancy: 'Instagram content specifically — a researched, on-brand week of Instagram posts. Prefer this over "social" whenever the goal is Instagram.',
    linkedin: 'LinkedIn outreach sequences, connection requests, InMail',
    analytics: 'KPIs, attribution, reporting frameworks',
    cro: 'Conversion optimisation, A/B test designs, landing page audits',
    deck: 'Pitch decks, sales presentations, one-pagers',
    video: 'Video scripts, thumbnails, YouTube strategy',
    compliance: 'Brand safety, legal review, GDPR, FTC checks',
    'compliance-automation': 'SOC 2/ISO 27001/GDPR/HIPAA automation plans, evidence collection, audit readiness, sales acceleration',
  };

  /**
   * Generate a multi-agent mission plan.
   * Returns a JSON object with missionTitle, missionSummary, and tasks[].
   *
   * Deliberately two stages instead of one big call: a non-streamed Opus
   * call planning out up to 7 detailed task prompts in one shot used to run
   * past Vercel's 60s function ceiling and die as a bare "API error 504"
   * (fixed once already by switching to streaming + trimming the request —
   * but one large call can still legitimately take a while to fully
   * generate). This goes further: pick the agents first with one small,
   * fast call, then generate EACH agent's task with its own small, fast
   * call, one at a time — sequentially, not in parallel, exactly to keep
   * every single request comfortably inside the ceiling rather than racing
   * one large request against it. More round trips, but each one is a
   * fresh, cheap request instead of a single one that has to do it all.
   */
  async function generateMissionPlan(goal, contextBundle, onProgress) {
    if (!window.ClaudeService) throw new Error('Claude API not configured. Add your API key in Settings.');
    const report = (detail) => { if (onProgress) onProgress(detail); };

    const ctxSummary = (contextBundle && contextBundle.isReady)
      ? `Company context: ${(contextBundle.businessContext || '').slice(0, 500)}
Competitive: ${(contextBundle.competitiveLandscape || '').slice(0, 250)}
Market signals: ${(contextBundle.marketSignals || '').slice(0, 200)}`
      : 'No Intelligence Layer configured. Plan for a generic B2B SaaS company.';

    // ── Stage 1: pick the agents (one small, fast call) ──────────────────
    const capabilityList = Object.entries(MISSION_AGENT_CAPABILITIES)
      .map(([key, desc]) => `- ${key}: ${desc}`).join('\n');

    const selectSystemPrompt = `You are a senior marketing operations director selecting which specialist agents should handle a marketing goal. Do not write any task instructions yet — only pick agents and a mission title/summary.

Available agents:
${capabilityList}

Rules:
- Select the 4–6 agents that best match the goal — do NOT always default to seo+competitive
- For prospect/outreach goals: prioritise sales → email → linkedin → content
- For campaign goals: prioritise content → ads → email → social

Respond ONLY with valid JSON — no markdown fences, no commentary:
{
  "missionTitle": "15 words max",
  "missionSummary": "2 sentences: what will be produced and the business impact",
  "agentKeys": ["sales", "email"]
}`;

    report({ stage: 'selecting' });
    const selectResult = await window.ClaudeService.streamResponse({
      systemPrompt: selectSystemPrompt,
      messages: [{ role: 'user', content: `Goal: ${goal}\n\nContext:\n${ctxSummary}` }],
    });

    const selectMatch = selectResult.match(/\{[\s\S]*\}/);
    if (!selectMatch) throw new Error('Mission plan parsing failed — Claude returned unexpected format');
    const selection = JSON.parse(selectMatch[0]);

    const agentKeys = Array.isArray(selection.agentKeys) ? selection.agentKeys.filter(k => MISSION_AGENT_CAPABILITIES[k]) : [];
    if (!agentKeys.length) throw new Error('Mission plan parsing failed — no valid agents were selected');
    report({ stage: 'selected', agentKeys, missionTitle: selection.missionTitle });

    // ── Stage 2: write each selected agent's task, one at a time ─────────
    const tasks = [];
    for (let i = 0; i < agentKeys.length; i++) {
      const agentKey = agentKeys[i];
      report({ stage: 'writing_task', agentKey, index: i, total: agentKeys.length });

      const taskSystemPrompt = `You are a senior marketing operations director writing ONE task as part of a larger autonomous marketing mission. The task will execute automatically without human intervention — make it self-contained and immediately executable.

This task is for the "${agentKey}" agent: ${MISSION_AGENT_CAPABILITIES[agentKey]}

Rules:
- userPrompt must be a complete, self-contained instruction (2–4 sentences) the agent can execute with no additional input
- Make it specific to the goal and mission context, not generic marketing boilerplate
- The task should produce a distinct, usable deliverable

Respond ONLY with valid JSON — no markdown fences, no commentary:
{
  "taskName": "short, specific task name",
  "objective": "one sentence",
  "userPrompt": "2-4 sentences of specific, self-contained instruction"
}`;

      const taskResult = await window.ClaudeService.streamResponse({
        systemPrompt: taskSystemPrompt,
        messages: [{
          role: 'user',
          content: `Mission: ${selection.missionTitle}\nMission summary: ${selection.missionSummary}\nOriginal goal: ${goal}\n\nContext:\n${ctxSummary}`,
        }],
      });

      const taskMatch = taskResult.match(/\{[\s\S]*\}/);
      if (!taskMatch) throw new Error(`Mission plan parsing failed for the ${agentKey} task — Claude returned unexpected format`);
      const taskData = JSON.parse(taskMatch[0]);
      tasks.push({ agentKey, ...taskData });
      report({ stage: 'task_done', agentKey, index: i, total: agentKeys.length, taskName: taskData.taskName });
    }

    return { missionTitle: selection.missionTitle, missionSummary: selection.missionSummary, tasks };
  }

  /**
   * Execute a single agent task inline (streaming).
   * Returns a promise that resolves to the full response text.
   */
  async function executeAgentTask(task, contextBundle, { onChunk, onDone, onError } = {}) {
    if (!window.ClaudeService) throw new Error('Claude API not configured');

    const systemPrompt = getAgentInlinePrompt(task.agentKey, contextBundle);
    const service = getServiceForAgent(task.agentKey);

    return streamWithFallback(service, task.agentKey, {
      systemPrompt,
      messages: [{ role: 'user', content: task.userPrompt }],
      onChunk,
      onDone,
      onError,
    });
  }

  /* ─────────────────────────────────────────────────────────────────────────
     AUTOMATION ASSESSMENT
     Scotty reviews completed agent work and plans executable automation steps.
  ───────────────────────────────────────────────────────────────────────── */

  /**
   * Scotty reviews all completed agent results and plans automation actions.
   * Returns { assessment: string, automations: Array } or throws.
   */
  async function assessAndPlanAutomation(plan, results, contextBundle, onProgress) {
    if (!window.ClaudeService) throw new Error('Claude API not configured. Add your API key in Settings.');
    const report = (detail) => { if (onProgress) onProgress(detail); };

    const resultsSummary = (results || [])
      .filter(r => r && r.text)
      .slice(0, 6)
      .map(r => `### ${r.task.taskName}\n${r.text.slice(0, 700)}`)
      .join('\n\n---\n\n');

    const ctxSnippet = (contextBundle && contextBundle.isReady)
      ? (contextBundle.businessContext || '').slice(0, 400)
      : 'No business context configured.';

    // ── Stage 1: assessment + automation ideas, no full prompts yet ──────
    // Same reasoning as generateMissionPlan() above: identifying 4-6 ideas
    // AND writing each one's full deployable-asset prompt in a single call
    // is exactly the shape of request that ran past Vercel's 60s ceiling
    // before. Splitting "what should we automate" from "write the actual
    // instruction for each one" keeps every individual call small.
    const ideaSystemPrompt = `You are Scotty, the AI CMO. You have just reviewed completed marketing analysis and must identify the highest-impact automation actions the platform can execute right now. Do not write the full instruction prompt yet — just the ideas.

Rules:
- Identify 4-6 specific automation actions, each producing a tangible deliverable
- Each automation runs inline via Claude — no external API or tool access required
- agentKey must be one of: seo, competitive, content, email, ads, social, nancy, cro, analytics, sales, linkedin, video, compliance, compliance-automation, deck
- Prioritise by impact: the user should feel they got a week's work done in 5 minutes

Respond ONLY with valid JSON — no markdown fences, no commentary:
{
  "assessment": "2-3 sentence CMO-level summary: what the agents accomplished and what the single biggest opportunity is now",
  "automations": [
    {
      "id": "auto_email_seq",
      "agentKey": "email",
      "title": "Build 5-Email Lead Nurture Sequence",
      "description": "Ready-to-deploy email copy based on the ICP and competitive analysis just completed",
      "impact": "High",
      "timeEstimate": "~2 min",
      "deliverable": "5 complete email templates"
    }
  ]
}`;

    report({ stage: 'assessing' });
    const ideaResult = await window.ClaudeService.streamResponse({
      systemPrompt: ideaSystemPrompt,
      messages: [{
        role: 'user',
        content: `Mission: ${plan.missionTitle || 'Marketing Campaign'}\n\nBusiness context:\n${ctxSnippet}\n\nCompleted agent work:\n${resultsSummary}`,
      }],
    });

    const ideaMatch = ideaResult.match(/\{[\s\S]*\}/);
    if (!ideaMatch) throw new Error('Automation assessment returned unexpected format');
    const ideaData = JSON.parse(ideaMatch[0]);
    const ideas = (Array.isArray(ideaData.automations) ? ideaData.automations : []).filter(idea => idea && idea.agentKey);
    report({ stage: 'assessed', count: ideas.length });

    // ── Stage 2: write each automation's actual prompt, one at a time ────
    const automations = [];
    for (let i = 0; i < ideas.length; i++) {
      const idea = ideas[i];
      report({ stage: 'writing_automation', agentKey: idea.agentKey, title: idea.title, index: i, total: ideas.length });

      const promptSystemPrompt = `You are Scotty, the AI CMO, writing the exact instruction for ONE automation the "${idea.agentKey}" agent will execute to CREATE a deployable asset (not analyse — CREATE). 2-3 sentences, specific enough to run with zero additional input.`;
      const promptResult = await window.ClaudeService.streamResponse({
        systemPrompt: promptSystemPrompt,
        messages: [{
          role: 'user',
          content: `Automation: ${idea.title}\nDeliverable: ${idea.deliverable || idea.description || ''}\n\nBusiness context:\n${ctxSnippet}\n\nCompleted agent work this automation builds on:\n${resultsSummary}\n\nWrite ONLY the instruction text itself — no preamble, no JSON, no quotes around it.`,
        }],
      });

      automations.push({ ...idea, prompt: promptResult.trim() });
      report({ stage: 'automation_done', agentKey: idea.agentKey, index: i, total: ideas.length });
    }

    return { assessment: ideaData.assessment, automations };
  }

  /**
   * Execute a single automation step — streams the generated deliverable.
   */
  async function executeAutomationStep(auto, contextBundle, { onChunk, onDone, onError } = {}) {
    if (!window.ClaudeService) throw new Error('Claude API not configured');
    const systemPrompt = getAgentInlinePrompt(auto.agentKey, contextBundle);
    const service = getServiceForAgent(auto.agentKey);
    return streamWithFallback(service, auto.agentKey, {
      systemPrompt,
      messages: [{ role: 'user', content: auto.prompt }],
      onChunk,
      onDone,
      onError,
    });
  }

  /**
   * Scotty reviews a single completed agent task and plans automation.
   * Used when the user returns to Scotty after dispatching to an individual agent.
   */
  async function assessSingleAgentResult(agentKey, taskName, resultText, contextBundle) {
    if (!window.ClaudeService) throw new Error('Claude API not configured');

    const ctxSnippet = (contextBundle && contextBundle.isReady)
      ? (contextBundle.businessContext || '').slice(0, 300)
      : '';

    const systemPrompt = `You are Scotty, the AI CMO. An agent just completed a task and you need to identify follow-on automation actions that will turn the analysis into deployable assets.

Identify 2-4 concrete follow-on automations. Each must:
- Produce a tangible deliverable the user can immediately use
- Logically follow from the completed work
- Be executable inline via Claude

Respond ONLY with valid JSON:
{
  "assessment": "2 sentences: what was accomplished and the immediate next step",
  "automations": [
    {
      "id": "auto_followon",
      "agentKey": "email",
      "title": "Create Outreach Sequence",
      "description": "Turn the analysis into a 5-step outreach sequence",
      "impact": "High",
      "timeEstimate": "~2 min",
      "deliverable": "5 outreach templates",
      "prompt": "Based on this analysis, write..."
    }
  ]
}`;

    // Same non-streaming-Opus-vs-Vercel's-60s-ceiling fix as
    // generateMissionPlan() above — see the comment there.
    const result = await window.ClaudeService.streamResponse({
      systemPrompt,
      messages: [{
        role: 'user',
        content: `Completed agent: ${agentKey} — ${taskName}\n\nContext: ${ctxSnippet}\n\nCompleted work:\n${resultText.slice(0, 1200)}`,
      }],
    });

    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Assessment returned unexpected format');
    return JSON.parse(jsonMatch[0]);
  }

  /* ─────────────────────────────────────────────────────────────────────────
     CONSEQUENTIAL ACTION GUARD

     Every automation Scotty currently plans is inline Claude text generation
     — a draft, not a real send/publish/spend (see the "no external API or
     tool access required" rule in assessAndPlanAutomation's own prompt
     above). That's a policy this file enforces in ONE place, not something
     left for whichever agent integration gets wired up next to remember by
     hand — the 2026 Agent Audit flagged the absence of exactly this kind of
     central guard as the real gap, not any specific missing confirm().

     If a future automation genuinely represents sending an email, publishing
     a post, spending ad budget, or deleting/removing something, this makes
     it fail SAFE: it renders for manual review instead of auto-executing,
     even if the underlying capability to auto-execute it exists by then.
  ───────────────────────────────────────────────────────────────────────── */

  const CONSEQUENTIAL_ACTION_PATTERN = /\b(send|sent|sending|publish(ed|ing)?|post(ed|ing)?\s+(to|on|live)|go(es|ing)?\s+live|launch(ed|ing)?\s+(the\s+)?(ad|campaign|budget)|spend(ing)?|delete(d|ing)?|remove(d|ing)?|charge(d|ing)?|purchase(d|ing)?)\b/i;

  function classifyAutomation(auto) {
    const text = [auto && auto.title, auto && auto.description, auto && auto.prompt]
      .filter(Boolean)
      .join(' ');
    return CONSEQUENTIAL_ACTION_PATTERN.test(text) ? 'requires_approval' : 'autonomous';
  }

  return {
    ask,
    dispatch,
    dispatchNewTab,
    goToScotty,
    goToHub,
    routeToAgent,
    detectAgent,
    saveMemory,
    getMemory,
    clearMemory,
    getContextBundle,
    buildScottySystemPrompt,
    isOrchestrationIntent,
    generateMissionPlan,
    executeAgentTask,
    getAgentInlinePrompt,
    assessAndPlanAutomation,
    executeAutomationStep,
    assessSingleAgentResult,
    classifyAutomation,
    AGENT_ROUTES,
    AGENT_DESCRIPTIONS,
  };
})();

window.ScottyOrchestrator = ScottyOrchestrator;
