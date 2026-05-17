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
${ctx}
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
${ctx}
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
${ctx}
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

  /**
   * Generate a multi-agent mission plan via Claude.
   * Returns a JSON object with missionTitle, missionSummary, and tasks[].
   */
  async function generateMissionPlan(goal, contextBundle) {
    if (!window.ClaudeService) throw new Error('Claude API not configured. Add your API key in Settings.');

    const ctxSummary = (contextBundle && contextBundle.isReady)
      ? `Company context: ${(contextBundle.businessContext || '').slice(0, 500)}
Competitive: ${(contextBundle.competitiveLandscape || '').slice(0, 250)}
Market signals: ${(contextBundle.marketSignals || '').slice(0, 200)}`
      : 'No Intelligence Layer configured. Plan for a generic B2B SaaS company.';

    const systemPrompt = `You are a senior marketing operations director. Given a goal, select the 5–7 most impactful specialist agents and define exactly what each should produce.

Available agents: seo, competitive, content, email, ads, social, cro, analytics, sales, linkedin, video, compliance, deck

Rules:
- Always include seo and competitive as baseline
- Add 3–5 more based on the goal
- Make task objectives and userPrompts specific, not generic
- userPrompt should be 2–3 sentences that tell the agent exactly what to produce for THIS business

Respond ONLY with valid JSON matching this exact structure (no markdown fences):
{
  "missionTitle": "15 words max describing the campaign",
  "missionSummary": "2 sentences describing what this orchestration will produce and why it matters",
  "tasks": [
    {
      "agentKey": "seo",
      "taskName": "Keyword & Content Gap Analysis",
      "objective": "one sentence",
      "userPrompt": "2-3 sentences of specific instruction for this agent"
    }
  ]
}`;

    const result = await window.ClaudeService.callAgent({
      systemPrompt,
      messages: [{ role: 'user', content: `Goal: ${goal}\n\nContext:\n${ctxSummary}` }],
    });

    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Mission plan parsing failed — Claude returned unexpected format');
    return JSON.parse(jsonMatch[0]);
  }

  /**
   * Execute a single agent task inline (streaming).
   * Returns a promise that resolves to the full response text.
   */
  async function executeAgentTask(task, contextBundle, { onChunk, onDone, onError } = {}) {
    if (!window.ClaudeService) throw new Error('Claude API not configured');

    const systemPrompt = getAgentInlinePrompt(task.agentKey, contextBundle);

    return window.ClaudeService.streamResponse({
      systemPrompt,
      messages: [{ role: 'user', content: task.userPrompt }],
      onChunk,
      onDone,
      onError,
    });
  }

  return {
    ask,
    dispatch,
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
    AGENT_ROUTES,
    AGENT_DESCRIPTIONS,
  };
})();

window.ScottyOrchestrator = ScottyOrchestrator;
