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
    blade:       '/agents/blade-agent.html',
    chase:       '/agents/sales-agent.html',
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
    blade:       'Blade — finds REAL local businesses (e.g. plumbers in Austin) from Google, checks each one\'s website, and shortlists the ones with a genuine website opportunity, with contact emails and owner names where they can actually be found',
    chase:       'Chase — runs a REAL audit of each business\'s website (technology/platform, SEO, mobile, speed, conversion, local SEO) and scores how strong a website opportunity each one is',
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
    blade: 'Finds a REAL shortlist of local businesses (a trade in a named city/area) whose websites are missing, outdated or on a template builder, with real contact emails and owner names where findable. Runs for real — produces actual leads, not a plan. Use for "find/prospect local [trade] in [place]" goals.',
    delivery: 'Pat — drafts ONE real outreach email (subject, body, link), runs it through the send-time checks and Scotty QA review, and prepares the audience. Runs for real; sends nothing until a person approves and sends it. Use for outreach to businesses already found (e.g. after blade) — needs a stated offer.',
    chase: 'Audits the websites of businesses found by blade (or a typed list of site addresses) for real — platform, SEO, mobile, speed, conversion — and scores each as an opportunity. Runs for real; approving tags the prospects in the audience by opportunity strength. Use after blade when website quality matters to the offer.',
    email: 'Full email copy (subject lines, body, CTAs), sequences, campaigns',
    content: 'Blog posts, landing page copy, case studies, thought leadership',
    seo: 'Researches a website\'s competitors and keyword gaps for real, proposes content topics with search volumes (real where available, otherwise clearly labelled estimates), and writes full SEO articles. Runs for real; approving saves the plan and articles into the SEO Content Engine. Needs a website address. Not a technical site audit.',
    competitive: 'Competitor analysis, positioning gaps, battlecards',
    ads: 'Google/Meta/LinkedIn ad copy and creative variants',
    social: 'Writes a batch of platform-native TEXT posts for LinkedIn, X and Facebook (not Instagram — that\'s nancy; not TikTok). Runs for real; approving puts the publishable posts in the Content Calendar, ready to schedule. Needs a topic.',
    nancy: 'Instagram content specifically — researches the business\'s website and market for real, then writes and designs a week of seven on-brand Instagram posts with finished graphics. Runs for real; approving puts the posts in the Content Calendar, ready to schedule. Prefer this over "social" whenever the goal is Instagram.',
    linkedin: 'LinkedIn outreach sequences, connection requests, InMail',
    analytics: 'KPIs, attribution, reporting frameworks',
    cro: 'Conversion optimisation, A/B test designs, landing page audits',
    deck: 'Pitch decks, sales presentations, one-pagers',
    video: 'Video scripts, thumbnails, YouTube strategy',
    compliance: 'Brand safety, legal review, GDPR, FTC checks',
    'compliance-automation': 'SOC 2/ISO 27001/GDPR/HIPAA automation plans, evidence collection, audit readiness, sales acceleration',
  };

  /* ─────────────────────────────────────────────────────────────────────────
     JSON EXTRACTION FROM LLM RESPONSES

     Every planning call below asks Claude to "respond ONLY with valid JSON",
     but Claude is not a JSON serializer — an unescaped raw newline or quote
     left inside a string value (a multi-line description, an em-dash inside
     quoted text) is enough to break JSON.parse. The result was V8 errors
     like "expected double-quoted property name at line 14 column 35" —
     accurate about where the parser gave up, useless about what actually
     went wrong — surfaced verbatim as "Could not generate automation plan"
     with no way to recover except starting the mission over.

     parseJsonLoose repairs the mechanical, common breakages (trailing
     commas, un-escaped control characters inside strings) without ever
     inventing or guessing content, and callJsonPrompt retries the request
     itself once before giving up, since a second, independent generation is
     often simply well-formed. Only if both a fixed-up parse and a retry fail
     does this throw — and then with the real parse error and a snippet of
     the offending text attached, not a dead end.
  ───────────────────────────────────────────────────────────────────────── */

  function parseJsonLoose(raw, label) {
    const match = String(raw || '').match(/\{[\s\S]*\}/);
    if (!match) {
      const err = new Error(`${label} returned unexpected format — no JSON object found in the response.`);
      err.rawText = String(raw || '').slice(0, 500);
      throw err;
    }
    const text = match[0];

    try { return JSON.parse(text); } catch (e) { /* try repairs below */ }

    // A trailing comma before a closing bracket/brace is valid in JS object
    // literals but not JSON — a frequent slip when a model writes JSON the
    // way it writes code.
    let repaired = text.replace(/,(\s*[}\]])/g, '$1');
    try { return JSON.parse(repaired); } catch (e) { /* keep going */ }

    // Un-escaped raw newlines/tabs inside a quoted string are the other
    // frequent cause — and the direct match for "expected double-quoted
    // property name": the parser hits the raw linebreak, ends the string
    // early, and reads whatever follows as if it were the start of a new
    // key. Escaping control characters found INSIDE quoted spans (not
    // between them) fixes this without touching real JSON structure.
    repaired = repaired.replace(/"(?:[^"\\]|\\.)*"/g, (m) =>
      m.replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t'));
    try { return JSON.parse(repaired); }
    catch (e) {
      const err = new Error(`${label} returned malformed JSON (${e.message}).`);
      err.rawText = text.slice(0, 500);
      throw err;
    }
  }

  async function callJsonPrompt(request, label, { retries = 1 } = {}) {
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const text = await window.ClaudeService.streamResponse(request);
      try { return parseJsonLoose(text, label); }
      catch (e) { lastErr = e; }
    }
    throw lastErr;
  }

  /* ─────────────────────────────────────────────────────────────────────────
     REAL EXECUTORS
     Every other agent key still runs as a Claude write-up (executeAgentTask).
     An agent listed here runs its actual backend pipeline and produces a real
     artifact in the database, waiting for the user's one-click approval.
  ───────────────────────────────────────────────────────────────────────── */

  const REAL_EXECUTORS = new Set(['blade', 'chase', 'delivery', 'nancy', 'social', 'seo']);

  // Real executors hand work down the line (Blade's list → Chase's audit →
  // Pat's email), so whatever order the model listed them in, they run in this
  // one. Everything else keeps its relative position.
  const REAL_PIPELINE_ORDER = ['blade', 'chase', 'delivery'];   // Nancy is independent of this chain and keeps its place
  function orderForExecution(keys) {
    const unique = [...new Set(keys)];
    const rank = (k) => REAL_PIPELINE_ORDER.indexOf(k);
    const slots = unique.map((k, i) => i).filter(i => rank(unique[i]) >= 0);
    const sorted = slots.map(i => unique[i]).sort((a, b) => rank(a) - rank(b));
    const out = unique.slice();
    slots.forEach((slot, n) => { out[slot] = sorted[n]; });
    return out;
  }

  function isRealExecutor(agentKey) { return REAL_EXECUTORS.has(agentKey); }

  const BLADE_TASK_SYSTEM_PROMPT = `You are a senior marketing operations director setting up ONE task for Blade, an agent that finds REAL local businesses on Google and checks their websites.

Blade needs three inputs. Fill each ONLY from what the goal (or, for the place, the business context) actually states — never guess:
- sector: the trade or business type to find, in plural (e.g. "plumbers", "dental clinics")
- city: the city, suburb or area to search
- country: the country, if stated or obvious from the place named
If the goal does not state one of them, return an empty string for it. Do not pick a "sensible" city; a person will be asked.

Respond ONLY with valid JSON — no markdown fences, no commentary:
{
  "taskName": "short, specific task name",
  "objective": "one sentence on who is being found and why",
  "params": { "sector": "", "city": "", "country": "" }
}`;

  function sanitizeBladeParams(p) {
    const clean = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, 80);
    const src = (p && typeof p === 'object') ? p : {};
    return { sector: clean(src.sector), city: clean(src.city), country: clean(src.country) };
  }

  function describeBladeParams(params) {
    const where = [params.city, params.country].filter(Boolean).join(', ');
    return `Find ${params.sector || '[trade]'} in ${where || '[place]'} whose websites are missing, outdated, or on a template builder.`;
  }

  /** What's still missing before a real Blade run can start, in plain words. */
  function missingBladeInputs(params) {
    const p = sanitizeBladeParams(params);
    const missing = [];
    if (!p.sector) missing.push('the trade to find (e.g. plumbers)');
    if (!p.city) missing.push('the city or area to search');
    return missing;
  }

  /**
   * Run Blade for real: search → audit → shortlist (one call), then find
   * contact details a few leads at a time until none remain. Everything is
   * saved server-side as a mission artifact awaiting approval.
   *
   * Resumable: progress is kept on task._bladeState, so a retry after a
   * failure partway through continues enriching the same list instead of
   * searching again and paying for Places a second time.
   *
   * @param {object} task  { params: {sector, city, country} }
   * @param {object} opts  { authHeaders: () => Promise<headers>, intelProfileId, missionId, onStatus, fetchImpl }
   */
  async function runBladeTask(task, { authHeaders, intelProfileId, missionId, onStatus, fetchImpl } = {}) {
    const doFetch = fetchImpl || ((...a) => fetch(...a));
    const say = (msg) => { if (onStatus) onStatus(msg); };
    const params = sanitizeBladeParams(task.params);
    const missing = missingBladeInputs(params);
    if (missing.length) throw new Error(`Blade needs ${missing.join(' and ')} before it can search.`);

    async function post(body) {
      const res = await doFetch('/api/mission-blade', { method: 'POST', headers: await authHeaders(), body: JSON.stringify(body) });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error((data && data.error) || `Blade request failed (HTTP ${res.status})`);
      return data;
    }

    const state = task._bladeState || (task._bladeState = {});
    if (!state.artifactId) {
      say(`Searching Google for ${params.sector} in ${params.city}…`);
      const found = await post({ action: 'discover', ...params, intelProfileId: intelProfileId || undefined, missionId: missionId || undefined });
      state.artifactId = found.artifactId;
      state.status = found.status;
      state.stats = found.stats;
      state.note = found.note;
      state.leads = found.leads || [];
      state.remaining = found.remaining || 0;
    }

    let guard = 0;
    while (state.remaining > 0 && guard++ < 60) {
      const total = state.leads.length;
      say(`Finding contact details… ${total - state.remaining}/${total} checked`);
      const batch = await post({ action: 'enrich', artifactId: state.artifactId });
      if (!batch.processed) break; // nothing advanced — don't spin
      for (const l of batch.leads || []) {
        const i = state.leads.findIndex(x => x.placeId === l.placeId);
        if (i >= 0) state.leads[i] = l;
      }
      state.remaining = batch.remaining;
      state.status = batch.status;
    }

    // A lookup that stopped advancing is a failed task, not a finished one —
    // leaving it looking complete would offer an approval the server (rightly)
    // refuses, since the list is still being built. Throwing lets the
    // mission's normal retry pick up where this left off.
    if (state.remaining > 0) {
      throw new Error(`Contact lookup stalled with ${state.remaining} lead${state.remaining === 1 ? '' : 's'} still to check.`);
    }

    return {
      artifactId: state.artifactId, status: state.status, stats: state.stats || {},
      note: state.note, leads: state.leads, complete: true,
    };
  }

  /** A plain-markdown account of a real Blade result, for the mission report. */
  function describeBladeResult(result) {
    const s = result.stats || {};
    if (!result.leads || !result.leads.length) {
      return `**Blade searched for real** — ${result.note || 'no qualifying businesses were found.'}`;
    }
    const withEmail = result.leads.filter(l => l.email).length;
    const withOwner = result.leads.filter(l => l.ownerFirstName).length;
    const viaSearch = result.leads.filter(l => l.email && (l.emailSource === 'estimate' || l.emailSource === 'search_verified')).length;
    const lines = [
      `**Blade ran for real.** Searched Google for "${s.query || ''}", checked ${s.candidatesChecked ?? '?'} businesses' websites, and shortlisted ${result.leads.length} with a genuine opportunity (${s.noWebsite ?? 0} with no website, ${s.builderLocked ?? 0} on a template builder).`,
      `Contact details actually found: ${withEmail} email${withEmail === 1 ? '' : 's'}${viaSearch ? ` (${viaSearch} from searching Google/social listings — those are labelled, and any not confirmed on the page they came from are marked unverified)` : ''}, ${withOwner} owner name${withOwner === 1 ? '' : 's'}. Anything not found is left blank, not guessed.`,
      '',
      '| Business | Site | Email | Owner |',
      '|---|---|---|---|',
      ...result.leads.slice(0, 15).map(l => `| ${l.name} | ${l.siteStatus === 'no_website' ? 'No website' : (l.sitePlatform || l.siteStatus)} | ${l.email || '—'} | ${l.ownerFirstName || '—'} |`),
    ];
    if (result.leads.length > 15) lines.push(`…and ${result.leads.length - 15} more.`);
    lines.push('', 'Waiting for your approval — nothing has been imported or sent.');
    return lines.join('\n');
  }


  const CHASE_TASK_SYSTEM_PROMPT = `You are a senior marketing operations director setting up ONE task for Chase, an agent that audits business websites for real and scores each as a sales opportunity.

Chase audits either the websites on the Blade shortlist from the same mission, or a typed list of website addresses. Fill these ONLY from what the goal states — never guess or invent a website:
- urls: website addresses the goal explicitly names (usually none — Chase normally uses Blade's list)
- industry: the trade or business type being audited, if stated

Respond ONLY with valid JSON — no markdown fences, no commentary:
{
  "taskName": "short, specific task name",
  "objective": "one sentence on whose websites are audited and why",
  "params": { "industry": "", "urls": [] }
}`;

  function sanitizeChaseParams(p) {
    const src = (p && typeof p === 'object') ? p : {};
    const industry = String(src.industry == null ? '' : src.industry).replace(/\s+/g, ' ').trim().slice(0, 80);
    const raw = Array.isArray(src.urls) ? src.urls : String(src.urls || '').split(/[\s,]+/);
    const urls = [...new Set(raw.map(u => String(u || '').trim()).filter(Boolean))].slice(0, 25);
    return { industry, urls };
  }

  function describeChaseParams(params) {
    return params.urls && params.urls.length
      ? `Audit ${params.urls.length} website${params.urls.length === 1 ? '' : 's'} and score each as a website opportunity.`
      : 'Audit the websites Blade found and score each as a website opportunity.';
  }

  /** Chase needs a website list from somewhere: Blade earlier in the mission, or typed addresses. */
  function missingChaseInputs(params, { hasBladeSource } = {}) {
    if (hasBladeSource) return [];
    return sanitizeChaseParams(params).urls.length ? [] : ['the website addresses to audit (or a Blade search earlier in the mission)'];
  }

  /**
   * Run Chase for real: build the list (from Blade's finished artifact, or the
   * typed addresses), then audit a few sites at a time until none remain.
   * Resumable via task._chaseState, like Blade, so a retry never re-starts the list.
   *
   * @param {object} task  { params: {industry, urls} }
   * @param {object} opts  { authHeaders, intelProfileId, missionId, sourceArtifactId, onStatus, fetchImpl }
   */
  async function runChaseTask(task, { authHeaders, intelProfileId, missionId, sourceArtifactId, onStatus, fetchImpl } = {}) {
    const doFetch = fetchImpl || ((...a) => fetch(...a));
    const say = (msg) => { if (onStatus) onStatus(msg); };
    const params = sanitizeChaseParams(task.params);
    const missing = missingChaseInputs(params, { hasBladeSource: !!sourceArtifactId });
    if (missing.length) throw new Error(`Chase needs ${missing.join(' ')} before it can audit.`);

    async function post(body) {
      const res = await doFetch('/api/mission-chase', { method: 'POST', headers: await authHeaders(), body: JSON.stringify(body) });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error((data && data.error) || `Chase request failed (HTTP ${res.status})`);
      return data;
    }

    const state = task._chaseState || (task._chaseState = {});
    if (!state.artifactId) {
      say('Preparing the list of websites to audit…');
      const started = await post({
        action: 'start', industry: params.industry || undefined,
        ...(sourceArtifactId ? { sourceArtifactId } : { urls: params.urls }),
        intelProfileId: intelProfileId || undefined, missionId: missionId || undefined,
      });
      Object.assign(state, {
        artifactId: started.artifactId, status: started.status, source: started.source,
        truncated: started.truncated, note: started.note, leads: started.leads || [], remaining: started.remaining || 0,
      });
    }

    let guard = 0;
    while (state.remaining > 0 && guard++ < 40) {
      const total = state.leads.length;
      say(`Auditing websites… ${total - state.remaining}/${total} done`);
      const batch = await post({ action: 'audit', artifactId: state.artifactId });
      if (!batch.processed) break;
      for (const l of batch.leads || []) {
        const i = state.leads.findIndex(x => x.key === l.key);
        if (i >= 0) state.leads[i] = l;
      }
      state.remaining = batch.remaining;
      state.status = batch.status;
    }
    // An audit that stopped advancing is a failed task, not a finished one.
    if (state.remaining > 0) throw new Error(`Website audit stalled with ${state.remaining} site${state.remaining === 1 ? '' : 's'} still to check.`);

    return { artifactId: state.artifactId, status: state.status, source: state.source, truncated: state.truncated, note: state.note, leads: state.leads, complete: true };
  }

  /** A plain-markdown account of a real Chase result, for the mission report. */
  function describeChaseResult(result) {
    if (!result.leads || !result.leads.length) return `**Chase ran for real** — ${result.note || 'there were no websites to audit.'}`;
    const scored = result.leads.filter(l => l.audit);
    const failed = result.leads.filter(l => l.auditError);
    const ranked = [...scored].sort((a, b) => b.audit.opportunity.score - a.audit.opportunity.score);
    const lines = [
      `**Chase ran for real.** Audited ${result.leads.length} website${result.leads.length === 1 ? '' : 's'}: ${scored.length} scored${failed.length ? `, ${failed.length} could not be audited (those are flagged, not scored)` : ''}.${result.truncated ? ' The list was capped; the rest were not audited.' : ''}`,
      '',
      '| Business | Platform | Opportunity | Biggest issue |',
      '|---|---|---|---|',
      ...ranked.slice(0, 15).map(l => `| ${l.name} | ${l.audit.platform || 'unknown'} | ${l.audit.opportunity.score} (${String(l.audit.opportunity.classification).replace(/_/g, ' ')}) | ${(l.audit.topProblems[0] && l.audit.topProblems[0].issue) || '—'} |`),
    ];
    if (ranked.length > 15) lines.push(`…and ${ranked.length - 15} more.`);
    lines.push('', 'Waiting for your approval — nothing has been changed or sent.');
    return lines.join('\n');
  }

  const NANCY_TASK_SYSTEM_PROMPT = `You are a senior marketing operations director setting up ONE task for Nancy, an agent that researches a business's website and market, then writes and designs a week of seven Instagram posts.

Nancy needs:
- websiteUrl: the business's own website address. Fill it ONLY from the goal or the business context — never guess or invent an address. If none is stated, return "".
- mustTalkAbout: anything the goal says the week must feature (a launch, an offer, an event), in a short phrase. "" if nothing is stated.

Respond ONLY with valid JSON — no markdown fences, no commentary:
{
  "taskName": "short, specific task name",
  "objective": "one sentence on what the week of posts is for",
  "params": { "websiteUrl": "", "mustTalkAbout": "" }
}`;

  function describeNancyResult(result) {
    const lines = [`**Nancy ran for real.** Researched ${result.businessName || 'the business'} and created ${result.posts.length} Instagram posts with finished graphics.`, ''];
    result.posts.forEach(p => lines.push(`- **Day ${p.day} — ${p.content_pillar || p.objective || ''}:** ${p.hook || p.slide_headline}${p.imageFallback ? ' _(simple graphic: the AI image could not be made)_' : ''}`));
    lines.push('', 'Waiting for your approval — nothing has been scheduled or published.');
    return lines.join('\n');
  }

  const SOCIAL_PLATFORMS = ['LinkedIn', 'Twitter/X', 'Facebook'];
  const SOCIAL_GOALS = ['Thought Leadership', 'Product Launch', 'Case Study', 'Engagement', 'Community Building'];

  const SOCIAL_TASK_SYSTEM_PROMPT = `You are a senior marketing operations director setting up ONE task for Social Studio, an agent that writes a batch of text posts for LinkedIn, X and Facebook.

Fill these ONLY from what the goal or business context states — never invent a topic:
- topic: what the posts should be about, in one or two short sentences. If the goal does not say, return "".
- contentGoal: exactly one of ${SOCIAL_GOALS.join(' | ')} — the one the goal most closely implies (Engagement if unclear)
- platforms: any of ${SOCIAL_PLATFORMS.join(', ')} the goal mentions; ["LinkedIn"] if none are named. Never Instagram or TikTok (other agents cover those).
- postCount: how many posts, 3 to 10 (6 if unstated)

Respond ONLY with valid JSON — no markdown fences, no commentary:
{
  "taskName": "short, specific task name",
  "objective": "one sentence on what the posts are for",
  "params": { "topic": "", "contentGoal": "Engagement", "platforms": ["LinkedIn"], "postCount": 6 }
}`;

  function sanitizeSocialParams(p) {
    const src = (p && typeof p === 'object') ? p : {};
    const platforms = [...new Set((Array.isArray(src.platforms) ? src.platforms : []).filter(x => SOCIAL_PLATFORMS.includes(x)))];
    return {
      topic: String(src.topic == null ? '' : src.topic).replace(/\s+/g, ' ').trim().slice(0, 400),
      contentGoal: SOCIAL_GOALS.includes(src.contentGoal) ? src.contentGoal : 'Engagement',
      platforms: platforms.length ? platforms : ['LinkedIn'],
      postCount: Math.max(3, Math.min(10, parseInt(src.postCount, 10) || 6)),
    };
  }

  function describeSocialParams(params) {
    return `Write ${params.postCount} ${params.platforms.join('/')} posts about: ${params.topic || '[topic]'}`;
  }

  function missingSocialInputs(params) {
    return sanitizeSocialParams(params).topic ? [] : ['what the posts should be about'];
  }

  /**
   * Run Social Studio for real: one server call writes and saves the batch as
   * a mission artifact awaiting approval. Remembered on task._socialState so a
   * retry never writes (and pays for) a second batch.
   *
   * @param {object} task  { params: {topic, contentGoal, platforms, postCount} }
   * @param {object} opts  { authHeaders, intelProfileId, projectId, missionId, businessContext, language, onStatus, fetchImpl }
   */
  async function runSocialTask(task, { authHeaders, intelProfileId, projectId, missionId, businessContext, language, onStatus, fetchImpl } = {}) {
    const doFetch = fetchImpl || ((...a) => fetch(...a));
    const params = sanitizeSocialParams(task.params);
    const missing = missingSocialInputs(params);
    if (missing.length) throw new Error(`Social Studio needs ${missing.join(' ')} before it can write.`);
    if (task._socialState && task._socialState.artifactId) return task._socialState;

    if (onStatus) onStatus(`Writing ${params.postCount} posts…`);
    const res = await doFetch('/api/mission-social', {
      method: 'POST', headers: await authHeaders(),
      body: JSON.stringify({
        action: 'generate', ...params, businessContext: businessContext || '', language: language || '',
        projectId: projectId || undefined, intelProfileId: intelProfileId || undefined, missionId: missionId || undefined,
      }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error((data && data.error) || `Social Studio request failed (HTTP ${res.status})`);
    task._socialState = {
      artifactId: data.artifactId, status: data.status, contentPlanNote: data.contentPlanNote || '',
      posts: data.posts || [], postable: data.postable || 0, complete: true,
    };
    return task._socialState;
  }

  function describeSocialResult(result) {
    const blocked = result.posts.filter(p => p.problem);
    const lines = [`**Social Studio wrote ${result.posts.length} posts for real.** ${result.contentPlanNote || ''}`.trim(), ''];
    result.posts.forEach(p => lines.push(`- **${p.platform} — ${p.title || p.hook}**${p.problem ? ` _(cannot be published as written: ${p.problem})_` : ''}`));
    if (blocked.length) lines.push('', `${blocked.length} post${blocked.length === 1 ? '' : 's'} will be left out when you approve, because ${blocked.length === 1 ? 'it cannot' : 'they cannot'} be published as written.`);
    lines.push('', 'Waiting for your approval — nothing has been scheduled or published.');
    return lines.join('\n');
  }

  const SEO_TASK_SYSTEM_PROMPT = `You are a senior marketing operations director setting up ONE task for the SEO agent, which researches a website's competitors and keyword gaps, proposes content topics, and writes full SEO articles.

It needs:
- websiteUrl: the business's own website address. Fill it ONLY from the goal or the business context — never guess or invent an address. If none is stated, return "".
- articleCount: how many full articles to write, 1 to 3 (2 if the goal doesn't say)

Respond ONLY with valid JSON — no markdown fences, no commentary:
{
  "taskName": "short, specific task name",
  "objective": "one sentence on what the content plan is for",
  "params": { "websiteUrl": "", "articleCount": 2 }
}`;

  function describeSeoResult(result) {
    const real = result.topics.filter(t => t.data_source === 'real').length;
    const lines = [
      `**The SEO agent ran for real.** Read the site, ${result.competitors && result.competitors.length ? `researched ${result.competitors.length} competitors, ` : ''}proposed ${result.topics.length} topics (${real} with a real search volume, ${result.topics.length - real} estimates) and wrote ${result.articles.length} article${result.articles.length === 1 ? '' : 's'}.`,
    ];
    if (result.competitorsNote) lines.push(`Competitor research: ${result.competitorsNote}`);
    if (result.volumesNote) lines.push(result.volumesNote);
    lines.push('', '**Articles written:**');
    result.articles.forEach(a => lines.push(`- ${a.title} — ${a.word_count || '?'} words, targeting "${a.target_keyword}"`));
    lines.push('', 'Waiting for your approval — nothing has been published. Approving saves the plan and articles into the SEO Content Engine.');
    return lines.join('\n');
  }

  const PAT_TASK_SYSTEM_PROMPT = `You are a senior marketing operations director setting up ONE task for Pat, an agent that drafts a real outreach email, checks it, and prepares the audience.

Pat needs these inputs. Fill each ONLY from what the goal or business context actually states — never guess or invent:
- offer: what is being offered to the recipients, in one or two plain sentences, using only facts stated
- ctaUrl: the link recipients should click, ONLY if a real URL is stated; otherwise ""
- audience: who it is going to, in plain words (e.g. "plumbers in Austin")
- audienceTags: contact tags that identify the audience. If the mission finds businesses with "blade", use ["blade-prospect", "<trade as lowercase-hyphenated plural, e.g. plumbers>"]; otherwise []
If the goal does not state the offer, return "" — a person will be asked. Do not write the email here.

Respond ONLY with valid JSON — no markdown fences, no commentary:
{
  "taskName": "short, specific task name",
  "objective": "one sentence on who is emailed and why",
  "params": { "offer": "", "ctaUrl": "", "audience": "", "audienceTags": [] }
}`;

  function sanitizePatParams(p) {
    const clean = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
    const src = (p && typeof p === 'object') ? p : {};
    let ctaUrl = clean(src.ctaUrl, 500);
    try { if (ctaUrl && !/^https?:$/.test(new URL(ctaUrl).protocol)) ctaUrl = ''; } catch { ctaUrl = ''; }
    const tags = Array.isArray(src.audienceTags) ? src.audienceTags : [];
    return {
      offer: clean(src.offer, 600),
      ctaUrl,
      audience: clean(src.audience, 200),
      audienceTags: [...new Set(tags.map(t => clean(t, 40).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')).filter(Boolean))].slice(0, 5),
    };
  }

  function describePatParams(params) {
    return `Draft an outreach email to ${params.audience || '[audience]'}: ${params.offer || '[offer]'}`;
  }

  function missingPatInputs(params) {
    return sanitizePatParams(params).offer ? [] : ['what you are offering them'];
  }

  /**
   * Run Pat for real: one server call that drafts, checks and reviews the
   * email and saves it as a mission artifact awaiting approval. If the server
   * needs a fact it will not invent, it answers with questions and this
   * throws them — the mission shows them rather than a made-up draft.
   *
   * @param {object} task  { params: {offer, ctaUrl, audience, audienceTags} }
   * @param {object} opts  { authHeaders, intelProfileId, missionId, sender: {senderName, companyName, businessContext}, expectedRecipients, onStatus, fetchImpl }
   */
  async function runPatTask(task, { authHeaders, intelProfileId, missionId, sender, expectedRecipients, onStatus, fetchImpl } = {}) {
    const doFetch = fetchImpl || ((...a) => fetch(...a));
    const params = sanitizePatParams(task.params);
    const missing = missingPatInputs(params);
    if (missing.length) throw new Error(`Pat needs ${missing.join(' and ')} before it can draft.`);

    if (task._patState && task._patState.artifactId) return task._patState;   // retry must not draft (and pay) twice
    if (onStatus) onStatus('Drafting the email and running the send-time checks…');
    const res = await doFetch('/api/mission-pat', {
      method: 'POST', headers: await authHeaders(),
      body: JSON.stringify({
        action: 'draft', ...params, ...(sender || {}),
        expectedRecipients: expectedRecipients || 0,
        intelProfileId: intelProfileId || undefined, missionId: missionId || undefined,
      }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error((data && data.error) || `Pat request failed (HTTP ${res.status})`);
    if (data.status === 'needs_input') {
      throw new Error(`Pat needs more from you: ${(data.questions || []).map(q => q.question).join(' ')}`);
    }
    task._patState = {
      artifactId: data.artifactId, subject: data.subject, html: data.html || '', text: data.text || '', preview: data.preview || {},
      review: data.review || { approved: false, blockers: [] }, fixed: !!data.fixed,
      questions: data.questions || [], audienceTags: params.audienceTags, complete: true,
    };
    return task._patState;
  }

  /** A plain-markdown account of a real Pat result, for the mission report. */
  function describePatResult(result) {
    const r = result.review || {};
    const lines = [`**Pat drafted for real.** Subject: "${result.subject}".`];
    if (r.approved) {
      lines.push(`It passed the send-time checks and Scotty's QA review${result.fixed ? ' (after one automatic fix)' : ''}.${r.summary ? ' ' + r.summary : ''}`);
      if ((r.warnings || []).length) lines.push('Warnings: ' + r.warnings.join('; '));
      lines.push('', 'Waiting for your approval — nothing has been sent.');
    } else {
      lines.push('It did **not** pass review, so it cannot be approved yet:');
      (r.blockers || []).forEach(b => lines.push(`- ${b}`));
      (result.questions || []).forEach(q => lines.push(`- Needs from you: ${q}`));
    }
    return lines.join('\n');
  }

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
- When the goal is to find LOCAL businesses of a particular trade in a particular place (plumbers, dentists, roofers…), use "blade" instead of "sales" — blade finds real businesses; never select both for the same prospecting job
- After blade, include "chase" when the offer depends on how good or bad each business's website is (website redesign, hosting, SEO): it audits every shortlisted site for real. Skip it when website quality is irrelevant
- When the goal is to email the businesses found (or an existing audience) about a stated offer, include "delivery" (Pat) — it drafts and checks one real email. Use "email" instead for sequences, newsletters or copy-only work
- For campaign goals: prioritise content → ads → email → social
- Also recommend a channelMix: 3-5 channels/content formats most worth leaning into for
  THIS specific goal this week (e.g. "Short-form video", "Carousels & images", "Email sequence",
  "Paid boosts", "LinkedIn posts") — pick names that make sense for the goal, not a fixed list.
  Each gets a 0-100 "focus" score for how much to lean into it. These are independent
  recommendations, not shares of a pie — several can score high at once, and they need not sum
  to 100. This is your judgment call as a strategist, not a measurement — do not present it as
  analytics.

Respond ONLY with valid JSON — no markdown fences, no commentary:
{
  "missionTitle": "15 words max",
  "missionSummary": "2 sentences: what will be produced and the business impact",
  "agentKeys": ["sales", "email"],
  "channelMix": [
    { "channel": "Short-form video", "focus": 86 },
    { "channel": "Email sequence", "focus": 60 }
  ]
}`;

    report({ stage: 'selecting' });
    const selection = await callJsonPrompt({
      systemPrompt: selectSystemPrompt,
      messages: [{ role: 'user', content: `Goal: ${goal}\n\nContext:\n${ctxSummary}` }],
    }, 'Mission plan selection');

    const agentKeys = orderForExecution(Array.isArray(selection.agentKeys) ? selection.agentKeys.filter(k => MISSION_AGENT_CAPABILITIES[k]) : []);
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

      const missionMessage = {
        role: 'user',
        content: `Mission: ${selection.missionTitle}\nMission summary: ${selection.missionSummary}\nOriginal goal: ${goal}\n\nContext:\n${ctxSummary}`,
      };

      // Blade runs for real, so its task is structured inputs the real
      // pipeline can act on (a trade and a place), not a prose instruction
      // for Claude to role-play. Anything the goal doesn't actually state
      // stays blank for the user to fill in before the mission starts — an
      // invented city would mean searching for the wrong businesses.
      let taskData;
      if (agentKey === 'blade') {
        const raw = await callJsonPrompt({
          systemPrompt: BLADE_TASK_SYSTEM_PROMPT,
          messages: [missionMessage],
        }, 'Mission plan task for the blade agent');
        const params = sanitizeBladeParams(raw.params);
        taskData = {
          taskName: String(raw.taskName || 'Find local prospects').slice(0, 80),
          objective: String(raw.objective || '').slice(0, 300),
          params,
          realExecutor: 'blade',
          userPrompt: describeBladeParams(params),
        };
      } else if (agentKey === 'seo' && window.SeoMission) {   // module missing → falls back to the written plan, never a half-real task
        const raw = await callJsonPrompt({
          systemPrompt: SEO_TASK_SYSTEM_PROMPT,
          messages: [missionMessage],
        }, 'Mission plan task for the seo agent');
        // The Business Brain's own website is a fact, not a guess: use it when the goal names none.
        const params = window.SeoMission.sanitizeParams({
          websiteUrl: (raw.params && raw.params.websiteUrl) || contextBundle.website || '',
          articleCount: raw.params && raw.params.articleCount,
        });
        taskData = {
          taskName: String(raw.taskName || 'SEO content plan').slice(0, 80),
          objective: String(raw.objective || '').slice(0, 300),
          params,
          realExecutor: 'seo',
          userPrompt: window.SeoMission.describeParams(params),
        };
      } else if (agentKey === 'social') {
        const raw = await callJsonPrompt({
          systemPrompt: SOCIAL_TASK_SYSTEM_PROMPT,
          messages: [missionMessage],
        }, 'Mission plan task for the social agent');
        const params = sanitizeSocialParams(raw.params);
        taskData = {
          taskName: String(raw.taskName || 'Write social posts').slice(0, 80),
          objective: String(raw.objective || '').slice(0, 300),
          params,
          realExecutor: 'social',
          userPrompt: describeSocialParams(params),
        };
      } else if (agentKey === 'nancy' && window.NancyMission) {
        const raw = await callJsonPrompt({
          systemPrompt: NANCY_TASK_SYSTEM_PROMPT,
          messages: [missionMessage],
        }, 'Mission plan task for the nancy agent');
        // The Business Brain's own website is a fact, not a guess: use it when the goal names none.
        const params = window.NancyMission.sanitizeParams({
          websiteUrl: raw.params && raw.params.websiteUrl || contextBundle.website || '',
          mustTalkAbout: raw.params && raw.params.mustTalkAbout,
        });
        taskData = {
          taskName: String(raw.taskName || 'Create Instagram week').slice(0, 80),
          objective: String(raw.objective || '').slice(0, 300),
          params,
          realExecutor: 'nancy',
          userPrompt: window.NancyMission.describeParams(params),
        };
      } else if (agentKey === 'chase') {
        const raw = await callJsonPrompt({
          systemPrompt: CHASE_TASK_SYSTEM_PROMPT,
          messages: [missionMessage],
        }, 'Mission plan task for the chase agent');
        const params = sanitizeChaseParams(raw.params);
        taskData = {
          taskName: String(raw.taskName || 'Audit prospect websites').slice(0, 80),
          objective: String(raw.objective || '').slice(0, 300),
          params,
          realExecutor: 'chase',
          userPrompt: describeChaseParams(params),
        };
      } else if (agentKey === 'delivery') {
        const raw = await callJsonPrompt({
          systemPrompt: PAT_TASK_SYSTEM_PROMPT,
          messages: [missionMessage],
        }, 'Mission plan task for the delivery agent');
        const params = sanitizePatParams(raw.params);
        taskData = {
          taskName: String(raw.taskName || 'Draft outreach email').slice(0, 80),
          objective: String(raw.objective || '').slice(0, 300),
          params,
          realExecutor: 'delivery',
          userPrompt: describePatParams(params),
        };
      } else {
        taskData = await callJsonPrompt({
          systemPrompt: taskSystemPrompt,
          messages: [missionMessage],
        }, `Mission plan task for the ${agentKey} agent`);
      }
      tasks.push({ agentKey, ...taskData });
      report({ stage: 'task_done', agentKey, index: i, total: agentKeys.length, taskName: taskData.taskName });
    }

    // Never trust the shape blindly — a channel name is free text and a focus
    // score is a number Claude wrote, both need the same defensive filtering
    // every other AI-produced field in this file gets before it reaches the UI.
    const channelMix = Array.isArray(selection.channelMix)
      ? selection.channelMix
          .filter(c => c && typeof c.channel === 'string' && c.channel.trim() && Number.isFinite(Number(c.focus)))
          .map(c => ({ channel: c.channel.trim().slice(0, 40), focus: Math.max(0, Math.min(100, Math.round(Number(c.focus)))) }))
          .slice(0, 5)
      : [];

    return { missionTitle: selection.missionTitle, missionSummary: selection.missionSummary, tasks, channelMix };
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
    const ideaData = await callJsonPrompt({
      systemPrompt: ideaSystemPrompt,
      messages: [{
        role: 'user',
        content: `Mission: ${plan.missionTitle || 'Marketing Campaign'}\n\nBusiness context:\n${ctxSnippet}\n\nCompleted agent work:\n${resultsSummary}`,
      }],
    }, 'Automation assessment');
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
    return callJsonPrompt({
      systemPrompt,
      messages: [{
        role: 'user',
        content: `Completed agent: ${agentKey} — ${taskName}\n\nContext: ${ctxSnippet}\n\nCompleted work:\n${resultText.slice(0, 1200)}`,
      }],
    }, 'Follow-on automation assessment');
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
    isRealExecutor,
    orderForExecution,
    runBladeTask,
    describeBladeResult,
    sanitizeBladeParams,
    describeBladeParams,
    missingBladeInputs,
    runChaseTask,
    describeSeoResult,
    runSocialTask,
    describeSocialResult,
    sanitizeSocialParams,
    describeSocialParams,
    missingSocialInputs,
    SOCIAL_PLATFORMS,
    SOCIAL_GOALS,
    describeNancyResult,
    describeChaseResult,
    sanitizeChaseParams,
    describeChaseParams,
    missingChaseInputs,
    runPatTask,
    describePatResult,
    sanitizePatParams,
    describePatParams,
    missingPatInputs,
    getAgentInlinePrompt,
    assessAndPlanAutomation,
    executeAutomationStep,
    assessSingleAgentResult,
    classifyAutomation,
    parseJsonLoose,
    callJsonPrompt,
    AGENT_ROUTES,
    AGENT_DESCRIPTIONS,
  };
})();

window.ScottyOrchestrator = ScottyOrchestrator;
