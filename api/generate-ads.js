/**
 * api/generate-ads.js — Social Media Ad Creative Engine
 *
 * POST {
 *   platforms:    string[],   // ['Meta/Facebook','LinkedIn','TikTok','Google Search','Twitter/X','YouTube']
 *   objective:    string,     // 'Awareness'|'Traffic'|'Leads'|'Conversions'|'Retargeting'
 *   product:      string,     // what is being advertised
 *   audience:     string,     // target audience description
 *   models:       string[],   // advertising frameworks: 'AIDA'|'PAS'|'BAB'|'Hook-Story-Offer'|'Ogilvy'|'StoryBrand'
 *   tone:         string,     // brand voice tone
 *   budget?:      string,     // optional budget context
 *   competitors?: string,     // optional competitor context
 *   variants:     number,     // number of variants per platform (default 5)
 * }
 *
 * Returns: { campaigns: [{ platform, framework, variants: [{headline, body, cta, visualDirection, abHypothesis, charCount}] }] }
 *
 * Uses Claude claude-sonnet-4-6. Requires ANTHROPIC_API_KEY env var.
 */

'use strict';

const RATE_LIMIT_WINDOW = 60 * 1000;
const RATE_LIMIT_MAX    = 8;
const rateBuckets       = new Map();

function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) return fwd.split(',')[0].trim();
  return req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
}

function checkRateLimit(ip) {
  const now = Date.now();
  let b = rateBuckets.get(ip);
  if (!b || now - b.windowStart > RATE_LIMIT_WINDOW) {
    b = { windowStart: now, count: 0 };
    rateBuckets.set(ip, b);
  }
  b.count++;
  return b.count <= RATE_LIMIT_MAX;
}

// ── Platform specs (character limits + visual guidance) ────────────────────
const PLATFORM_SPECS = {
  'Meta/Facebook': {
    headline:    { max: 40,  label: 'Headline' },
    body:        { max: 125, label: 'Primary Text (mobile truncates at 125)' },
    description: { max: 30,  label: 'Link Description' },
    cta_options: ['Learn More','Shop Now','Sign Up','Get Quote','Download','Watch More','Contact Us'],
    format:      'Image/Video + copy. Hook visible before "see more" fold at 125 chars. Emoji welcome.',
    visual:      'Stop-scroll creative: bold contrast, faces/emotions, single focus object on clean background.',
  },
  'LinkedIn': {
    headline:  { max: 70,  label: 'Headline' },
    body:      { max: 150, label: 'Introductory Text (first 150 chars shown before "more")' },
    cta_options: ['Learn More','Sign Up','Download','Get Quote','Register','Request Demo'],
    format:    'Professional tone. Job title/industry targeting. Thought leadership performs well.',
    visual:    'Professional photography, infographics, or clean stat graphics. No flashy consumer aesthetics.',
  },
  'TikTok': {
    body:      { max: 100, label: 'Ad Text' },
    cta_options: ['Learn More','Shop Now','Sign Up','Download','Contact Us'],
    format:    'Video-first. Hook in first 3 seconds. Text secondary. Trend-native, raw feel outperforms polished.',
    visual:    'Vertical 9:16 video. On-screen captions. Native UGC style beats studio production.',
  },
  'Google Search': {
    headline:     { max: 30,  label: 'Headlines (up to 15, shown 3 at a time)' },
    description:  { max: 90,  label: 'Descriptions (up to 4, shown 2 at a time)' },
    display_url:  { max: 15,  label: 'URL path (per segment)' },
    format:       'Keyword-intent matching. RSA format — pin most critical headlines to position 1/2. Use DKI sparingly.',
    visual:       'Text-only. Focus on intent match, clear benefit statement, and specific CTA.',
  },
  'Google Display': {
    headline:      { max: 30,  label: 'Short Headline' },
    long_headline: { max: 90,  label: 'Long Headline' },
    description:   { max: 90,  label: 'Description' },
    format:        'Responsive display ads — provide multiple headlines/descriptions, Google optimises. Image-forward.',
    visual:        'Clean product shot or lifestyle image, high contrast, minimal text overlay (<20% of image).',
  },
  'Twitter/X': {
    body:      { max: 280, label: 'Tweet text' },
    cta_options: ['Learn More','Shop Now','Sign Up','Book Now'],
    format:    'Conversational, direct, opinionated. Twitter-native voice. Threads for complex arguments.',
    visual:    '16:9 image or video. Muted autoplay for video ads — always caption.',
  },
  'YouTube': {
    headline:   { max: 15,  label: 'Headline (displayed below video)' },
    body:       { max: 70,  label: 'Description' },
    cta_options: ['Learn More','Shop Now','Sign Up','Get Quote','Download'],
    format:     'Skippable in-stream: hook in first 5 seconds. Non-skippable (15s) or bumper (6s). Brand recall focus.',
    visual:     'High-energy open 5s, clear brand mark early. Logo watermark throughout. Subtitle all speech.',
  },
};

// ── World-class advertising framework definitions ───────────────────────────
const AD_FRAMEWORKS = {
  'AIDA': {
    name: 'AIDA (Ogilvy/Hopkins Classic)',
    description: 'Attention → Interest → Desire → Action. The foundational direct-response framework used by Ogilvy, Hopkins, and every major DTC brand.',
    instruction: `Apply AIDA to every variant:
- ATTENTION: Open with a bold, disruptive hook — a shocking stat, provocative question, or surprising statement. Pattern-interrupt.
- INTEREST: Follow with a compelling reason why this matters to them specifically — link to their world, job, or problem.
- DESIRE: Build want by painting the outcome/transformation vividly. Use sensory or emotional language. Proof and social validation go here.
- ACTION: Close with one crystal-clear CTA that tells them exactly what to do next and what they'll get.
Character count for each section should be proportionate to the platform limit.`,
  },
  'PAS': {
    name: 'PAS (Problem-Agitate-Solution)',
    description: 'Problem → Agitate → Solution. Dan Kennedy\'s most battle-tested framework. Works exceptionally for pain-aware audiences.',
    instruction: `Apply PAS to every variant:
- PROBLEM: State the target audience's exact frustration in their own language. Be specific, not generic.
- AGITATE: Amplify the pain. What does NOT solving this cost them? What's the consequence of inaction? Make them feel the weight.
- SOLUTION: Introduce the product as the relief. Position it as the obvious, easiest path to solving the exact problem you just amplified.
Use ICP language — mirror the words they would use to describe their own problem, not marketing speak.`,
  },
  'BAB': {
    name: 'BAB (Before-After-Bridge)',
    description: 'Before → After → Bridge. Shows transformation. Exceptional for lead-gen and awareness stages.',
    instruction: `Apply BAB to every variant:
- BEFORE: Describe their current frustrating situation vividly. This is where they are now — the pain state.
- AFTER: Paint the desired outcome. What does success look and feel like? Be specific and aspirational.
- BRIDGE: Introduce the product as the path that takes them from Before to After. Make the connection explicit.
The After state must be emotionally compelling — not just functional, but how their life/business changes.`,
  },
  'Hook-Story-Offer': {
    name: 'Hook / Story / Offer (Hormozi / Brunson)',
    description: 'Alex Hormozi and Russell Brunson\'s direct response framework dominating digital ads since 2020.',
    instruction: `Apply Hook/Story/Offer to every variant:
- HOOK (first 3-5 words or visual): Must stop the scroll cold. Use pattern interrupts, bold claims, relatable frustrations, or curiosity gaps. No warm-ups — start with the hook.
- STORY: Brief narrative that earns trust and makes the offer feel inevitable. Can be a customer result, founder story, or before/after. Keep it tight — 1-3 sentences.
- OFFER: Make them an irresistible, specific offer. Not "try our product" — give them a reason to act NOW. Stack value, remove risk, add urgency if authentic.
The hook-to-story transition must feel natural, not jarring.`,
  },
  'Ogilvy': {
    name: 'Ogilvy Principles (Research-Driven)',
    description: 'David Ogilvy\'s 11 principles from "Confessions of an Advertising Man". The scientific advertising method.',
    instruction: `Apply Ogilvy\'s principles to every variant:
1. THE HEADLINE IS THE AD: 5x as many people read headlines. Include the benefit or the promise in the headline itself. News words ("Introducing", "Announcing", "Now") boost recall.
2. SPECIFICITY SELLS: Specific numbers outperform vague claims. "43% faster" beats "much faster". Use proof points.
3. LONG COPY WORKS (when justified): If the product needs explanation, write long. People DO read long ads for things they care about.
4. NEVER BORE THE READER: Every sentence must earn the next. Cut ruthlessly.
5. RESEARCH FIRST: Reference real customer language and real pain. Never invent problems.
6. TEST EVERYTHING: Every variant is a hypothesis. Name what's being tested.
7. THE BRAND IS SACRED: Every ad must build the long-term brand image, not just make a sale.`,
  },
  'StoryBrand': {
    name: 'StoryBrand (Donald Miller)',
    description: 'Donald Miller\'s 7-part framework: Customer is the hero, brand is the guide. Eliminates confusion.',
    instruction: `Apply StoryBrand to every variant:
- CUSTOMER IS THE HERO: Never position the brand as the hero. The customer's transformation is the story.
- CHARACTER: Name the character (the customer) and their desire.
- PROBLEM: Identify the villain (external problem), internal frustration, and philosophical injustice.
- GUIDE: Position the brand as a wise, empathetic guide — NOT the hero. "We've helped 1,000 companies like yours…"
- PLAN: Give a clear 3-step plan. Clarity reduces anxiety and increases conversion.
- CALL TO ACTION: Direct CTA (buy now, sign up) + transitional CTA (learn more, guide).
- STAKES: What do they gain by acting? What do they lose by not acting? Both must be explicit.
Every ad must eliminate confusion — if it requires effort to understand, rewrite.`,
  },
  'Byron Sharp': {
    name: 'Byron Sharp / How Brands Grow (Salience)',
    description: 'Evidence-based marketing science from the Ehrenberg-Bass Institute. Mental availability + distinctive assets = growth.',
    instruction: `Apply Byron Sharp\'s laws to every variant:
- MENTAL AVAILABILITY: Make it easy to think of the brand in the buying moment. Link the brand to buying situations, not just emotional states.
- DISTINCTIVE ASSETS: Consistently use the brand\'s distinctive assets (logo, colour, character, tagline). Every ad must be attributable to the brand even without reading the name.
- BROAD REACH OVER NICHE: Message to all potential buyers (reach), not just loyalists (loyalty). The objective is brand salience, not just conversion.
- REFRESHING MEMORY: Ads work by refreshing and building memory structures, not just persuading. Repetition of consistent distinctive elements matters.
- AVOID CLEVER-CLEVER: Simple, clear, memorable beats clever-but-confusing every time.
Apply these by keeping the brand prominent and consistent, even in variant testing.`,
  },
  'Cialdini': {
    name: 'Cialdini 7 Influence Principles',
    description: 'Robert Cialdini\'s 7 principles of persuasion. Each variant should leverage a distinct trigger.',
    instruction: `Each variant must be built around a different Cialdini principle. Assign one principle per variant:
1. SOCIAL PROOF: "Join 12,000 teams already using..." Numbers, testimonials, logos.
2. AUTHORITY: Credentials, awards, expert endorsements, media mentions. "As featured in Forbes…"
3. SCARCITY: Limited spots, time-limited offers, limited inventory. Must be genuine.
4. URGENCY: Deadline-driven. "Only until Friday" or event-based urgency.
5. RECIPROCITY: Give something free first. "Free guide," "free audit," "free trial" — lower the barrier.
6. COMMITMENT & CONSISTENCY: Reference a small prior action. "If you're already doing X, then Y is the obvious next step."
7. UNITY (7th principle): Shared identity. "Like you, we believe marketing should be transparent..." We're the same tribe.
Label each variant with its principle clearly.`,
  },
};

// ── Build the master system prompt ─────────────────────────────────────────
function buildSystemPrompt(platforms, models, objective, product, audience, tone, budget, competitors, variantCount) {
  const selectedModels = models.length ? models.map(m => AD_FRAMEWORKS[m]).filter(Boolean) : [AD_FRAMEWORKS['AIDA'], AD_FRAMEWORKS['PAS']];

  const platformList = platforms.map(p => {
    const spec = PLATFORM_SPECS[p];
    if (!spec) return `**${p}** — no spec available`;
    const limits = Object.entries(spec)
      .filter(([k]) => !['cta_options','format','visual'].includes(k))
      .map(([, v]) => `${v.label}: ${v.max} chars`).join(', ');
    return `**${p}**: ${limits}. Format: ${spec.format} Visual: ${spec.visual} CTAs: ${(spec.cta_options || []).join(' | ')}`;
  }).join('\n\n');

  const frameworkInstructions = selectedModels.map(f =>
    `### ${f.name}\n${f.description}\n\n${f.instruction}`
  ).join('\n\n---\n\n');

  return `You are the world's most accomplished performance advertising creative director, trained on every major advertising framework and $500M+ in ad spend data.

## YOUR MISSION
Generate ${variantCount} conversion-ready ad variants for each of ${platforms.length} platform(s). Every variant must be immediately usable — correct character counts, correct format, correct psychological trigger. No placeholders. No generic copy.

## CAMPAIGN BRIEF
- **Product/Offer:** ${product}
- **Target Audience:** ${audience}
- **Campaign Objective:** ${objective}
- **Brand Tone:** ${tone || 'Professional, direct, benefit-focused'}
${budget ? `- **Budget Context:** ${budget}` : ''}
${competitors ? `- **Competitive Context:** ${competitors}` : ''}

## PLATFORM SPECIFICATIONS
${platformList}

## ADVERTISING FRAMEWORKS IN USE
${frameworkInstructions}

## OBJECTIVE-SPECIFIC STRATEGY
${getObjectiveStrategy(objective)}

## OUTPUT FORMAT — STRICT
For each platform and each variant, use this exact structure:

---
## [Platform Name]

### Variant [N]: [Framework Name] — [Angle/Hook Name]
**Psychological Trigger:** [e.g. Pain Awareness + Urgency]
**Headline:** "[text]" (XX chars)
**Body/Primary Text:** "[text]" (XX chars)
**Description/Long Headline:** "[text]" (XX chars) ← only if platform has this field
**CTA Button:** [exact button text]
**Visual Direction:** [One sentence describing the ideal creative — what to show, mood, colours, format]
**A/B Hypothesis:** [What this variant tests, what winning looks like — e.g. ">2.5% CTR", "Lower CPL vs Variant 1"]

---

RULES:
1. Character counts MUST be accurate (count every character including spaces)
2. Never exceed platform character limits
3. No placeholder text — every field must be real, usable copy
4. Each variant must test a genuinely distinct angle, not just word changes
5. Visual Direction must be specific enough for a designer to execute immediately
6. Include a brief Campaign Strategy Note at the very top before the variants
7. For Google Search, provide 5 headlines + 2 descriptions in responsive ad format (not a single ad)
`;
}

function getObjectiveStrategy(objective) {
  const strategies = {
    'Awareness': `AWARENESS OBJECTIVE: Focus on problem education and pain amplification. Prioritise mental availability over direct conversion. CTAs should be low-commitment ("Learn more", "Discover"). Use Byron Sharp's salience principles — build brand memory structures. Hook with a surprising insight or statistic about the audience's problem.`,
    'Traffic': `TRAFFIC OBJECTIVE: Curiosity-gap hooks outperform direct pitches. Tease the answer, don't give it. Open loops drive clicks. Benefit-preview CTAs ("See how", "Discover", "Find out"). Mobile-first copy — assume thumb scrolling.`,
    'Leads': `LEAD GENERATION OBJECTIVE: Value-exchange messaging. Give something free to earn the lead. Social proof is critical at this stage — numbers, testimonials, logos. Make the ask specific and low-risk ("Free 15-min call", "Free audit", "Download guide"). Lead magnet framing beats product pitching.`,
    'Conversions': `CONVERSION OBJECTIVE: Urgency, differentiators, objection-handling. Assume they've heard of you — this is the decision moment. Remove all friction. Address the #1 objection head-on. Stack value. Money-back guarantee or trial reduces risk. Price anchoring works here. Use Cialdini scarcity/urgency principles.`,
    'Retargeting': `RETARGETING OBJECTIVE: They already know you. Don't re-introduce — close. Address why they didn't buy (objection handling, social proof to overcome doubt, urgency/scarcity for fence-sitters). Limited-time offers work here. "Still thinking about X?" personalisation angle. Sequence: 1st retarget = social proof, 2nd = benefit reminder, 3rd = urgency/offer.`,
  };
  return strategies[objective] || strategies['Conversions'];
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = getClientIp(req);
  if (!checkRateLimit(ip)) return res.status(429).json({ error: 'Too many requests. Slow down.' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });

  const {
    platforms   = ['Meta/Facebook'],
    objective   = 'Conversions',
    product,
    audience,
    models      = ['AIDA', 'PAS'],
    tone        = '',
    budget      = '',
    competitors = '',
    variants    = 5,
  } = req.body || {};

  if (!product || !audience) return res.status(400).json({ error: 'product and audience are required' });
  if (!Array.isArray(platforms) || platforms.length === 0) return res.status(400).json({ error: 'platforms must be a non-empty array' });

  const systemPrompt = buildSystemPrompt(
    platforms,
    Array.isArray(models) ? models : [models],
    objective,
    product,
    audience,
    tone,
    budget,
    competitors,
    Math.min(Number(variants) || 5, 8)
  );

  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type':      'application/json',
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-6',
        max_tokens: 8000,
        system:     systemPrompt,
        messages: [{
          role:    'user',
          content: `Generate the complete ad campaign now. ${platforms.length} platform(s): ${platforms.join(', ')}. ${Math.min(Number(variants)||5,8)} variants each. Frameworks: ${(Array.isArray(models)?models:[models]).join(', ')}. Objective: ${objective}. Make every word count — this is real ad spend going out the door.`,
        }],
      }),
      signal: AbortSignal.timeout(55000),
    });

    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      const errMsg = data.error?.message || `Anthropic error ${upstream.status}`;
      return res.status(upstream.status).json({ error: errMsg });
    }

    const content = data.content?.[0]?.text || '';
    return res.json({
      success:    true,
      content,
      platforms,
      objective,
      models,
      variants:   Math.min(Number(variants)||5, 8),
      usage:      data.usage,
    });

  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
};
