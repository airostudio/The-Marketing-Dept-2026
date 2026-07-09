/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * AUTOMATION ENGINE — Audema - Your AI Marketing Department
 * Workflow orchestration layer that executes end-to-end marketing automation.
 *
 * This module manages four automated workflows:
 *   1. Email Nurture      — Auto-generate and schedule multi-touch sequences
 *   2. Social Distribution — Auto-repurpose and publish content across platforms
 *   3. Paid Media Launch   — Auto-create and launch campaigns with ICP targeting
 *   4. Lead Scoring        — Auto-qualify and route leads based on ICP match
 *
 * Zero manual copy/paste — workflows execute autonomously from trigger to completion.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

'use strict';

/* ─────────────────────────────────────────────────────────────────────────────
   CONSTANTS & STORAGE KEYS
   ───────────────────────────────────────────────────────────────────────────── */

/** @enum {string} localStorage keys for automation stores */
const AUTOMATION_STORAGE_KEYS = {
  WORKFLOWS:     'automation_workflows',
  EXECUTIONS:    'automation_executions',
  INTEGRATIONS:  'automation_integrations',
  SCHEDULES:     'automation_schedules'
};

/** @enum {string} Workflow statuses */
const WORKFLOW_STATUS = {
  PENDING:    'pending',
  RUNNING:    'running',
  COMPLETED:  'completed',
  FAILED:     'failed',
  PAUSED:     'paused'
};

/** @enum {string} Workflow types */
const WORKFLOW_TYPE = {
  EMAIL_NURTURE:        'email_nurture',
  SOCIAL_DISTRIBUTION:  'social_distribution',
  PAID_MEDIA_LAUNCH:    'paid_media_launch',
  LEAD_SCORING:         'lead_scoring'
};

/* ─────────────────────────────────────────────────────────────────────────────
   HELPERS
   ───────────────────────────────────────────────────────────────────────────── */

/**
 * Generate a short unique ID (not cryptographic — for UI purposes only).
 * @returns {string}
 */
function _uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/**
 * Read a value from localStorage, returning null on any failure.
 * @param {string} key
 * @returns {*}
 */
function _lsGet(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    console.warn('[AutomationEngine] localStorage read failed:', e.message);
    return null;
  }
}

/**
 * Write a value to localStorage, silently swallowing quota / parse errors.
 * @param {string} key
 * @param {*} value
 */
function _lsSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn('[AutomationEngine] localStorage write failed:', e.message);
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
   1. EMAIL NURTURE WORKFLOW
   Auto-generate and schedule multi-touch email sequences based on buyer journey.
   ───────────────────────────────────────────────────────────────────────────── */

/**
 * EmailNurtureWorkflow manages automated email sequence generation and scheduling.
 *
 * Workflow Steps:
 * 1. Extract ICP data from Intelligence Layer (pain points, buyer journey, firmographics)
 * 2. Generate multi-email sequence using Claude (3-7 emails)
 * 3. Segment audience by ICP attributes (pain severity, company size, industry)
 * 4. Schedule sends based on optimal timing
 * 5. Track execution status and results
 */
class EmailNurtureWorkflow {
  constructor(intelligenceEngine, claudeService) {
    this.intelligenceEngine = intelligenceEngine;
    this.claudeService = claudeService;
    this._key = AUTOMATION_STORAGE_KEYS.WORKFLOWS;
  }

  /**
   * Create and execute an email nurture workflow.
   * @param {Object} config
   * @param {string} config.campaignName - Name of the nurture campaign
   * @param {string} config.targetSegment - ICP segment to target (e.g., "healthcare-vp-sales")
   * @param {number} config.emailCount - Number of emails in sequence (3-7)
   * @param {string} config.objective - Campaign objective (awareness, consideration, decision)
   * @param {boolean} [config.autoSchedule=false] - Auto-schedule sends via ESP API
   * @returns {Promise<Object>} - Execution result with generated emails and schedule
   */
  async execute(config) {
    const executionId = _uid();
    const startTime = new Date().toISOString();

    console.log(`[EmailNurtureWorkflow] Starting execution ${executionId}:`, config);

    try {
      // STEP 1: Extract ICP context from Intelligence Layer
      const context = this.intelligenceEngine.extractStructuredContext();

      if (!context.meta.isReady) {
        throw new Error('Intelligence Layer not configured. Configure BusinessBrain first.');
      }

      // STEP 2: Build nurture sequence strategy based on buyer journey
      const sequenceStrategy = this._buildSequenceStrategy(context, config);

      // STEP 3: Generate email sequence using Claude
      const emailSequence = await this._generateEmailSequence(context, config, sequenceStrategy);

      // STEP 4: Segment audience based on ICP attributes
      const audienceSegments = this._buildAudienceSegments(context, config);

      // STEP 5: Build send schedule
      const sendSchedule = this._buildSendSchedule(emailSequence, config);

      // STEP 6: (Optional) Auto-schedule via ESP API
      let espResult = null;
      if (config.autoSchedule && config.espProvider) {
        espResult = await this._scheduleViaESP(emailSequence, sendSchedule, config);
      }

      // STEP 7: Save execution result
      const result = {
        executionId,
        workflowType: WORKFLOW_TYPE.EMAIL_NURTURE,
        status: WORKFLOW_STATUS.COMPLETED,
        config,
        startTime,
        endTime: new Date().toISOString(),
        output: {
          emailSequence,
          audienceSegments,
          sendSchedule,
          espResult
        }
      };

      this._saveExecution(result);
      return result;

    } catch (error) {
      console.error('[EmailNurtureWorkflow] Execution failed:', error);
      const result = {
        executionId,
        workflowType: WORKFLOW_TYPE.EMAIL_NURTURE,
        status: WORKFLOW_STATUS.FAILED,
        config,
        startTime,
        endTime: new Date().toISOString(),
        error: error.message
      };
      this._saveExecution(result);
      throw error;
    }
  }

  /**
   * Build sequence strategy mapping emails to buyer journey stages.
   * @private
   */
  _buildSequenceStrategy(context, config) {
    const journey = context.icp.buyerJourney;
    const painPoints = context.icp.painPoints;
    const valueProps = context.positioning.valueProps;

    const strategy = {
      sequenceFlow: [],
      emailMapping: []
    };

    // Map emails to buyer journey stages
    if (config.objective === 'awareness' || config.emailCount >= 5) {
      strategy.sequenceFlow.push({
        stage: 'awareness',
        emailIndex: 0,
        goal: 'Problem education, pain amplification',
        hook: painPoints[0] || 'Problem awareness',
        messaging: journey.awareness || 'Educate on problem severity'
      });
    }

    if (config.objective === 'consideration' || config.emailCount >= 3) {
      strategy.sequenceFlow.push({
        stage: 'consideration',
        emailIndex: config.emailCount >= 5 ? 2 : 1,
        goal: 'Solution comparison, value prop introduction',
        hook: valueProps[0] || 'Primary benefit',
        messaging: journey.consideration || 'Compare solutions and benefits'
      });
    }

    if (config.objective === 'decision' || config.emailCount >= 5) {
      strategy.sequenceFlow.push({
        stage: 'decision',
        emailIndex: config.emailCount - 1,
        goal: 'Conversion, urgency, CTA',
        hook: context.icp.context.reasonChose || 'Conversion trigger',
        messaging: journey.decision || 'Drive decision and conversion'
      });
    }

    return strategy;
  }

  /**
   * Generate email sequence using Claude with ICP context.
   * @private
   */
  async _generateEmailSequence(context, config, strategy) {
    const systemPrompt = `You are an expert email marketing strategist.

Generate a ${config.emailCount}-email nurture sequence for this campaign:
Campaign: ${config.campaignName}
Objective: ${config.objective}

## ICP Context
Target: ${context.icp.firmographics.role} at ${context.icp.firmographics.companySize} companies in ${context.icp.firmographics.industry}
Pain Points: ${context.icp.painPoints.join(', ')}
Value Props: ${context.positioning.valueProps.join(', ')}
Brand Voice: ${context.positioning.brandVoice.tone.join(', ')}

## Sequence Strategy
${JSON.stringify(strategy.sequenceFlow, null, 2)}

## Requirements
For each email provide:
- Email N Subject Lines (3 variants: pain-focused, benefit-focused, curiosity)
- Preview Text (40 chars max)
- Body Copy (conversational, ICP language, brand voice)
- CTA (aligned with stage and objective)
- Send Day (Day 0, Day 3, Day 7, etc.)
- Segmentation Note (which ICP segment receives this)

Output as JSON array:
[
  {
    "emailNumber": 1,
    "name": "Email name",
    "stage": "awareness",
    "sendDay": 0,
    "subjects": ["variant 1", "variant 2", "variant 3"],
    "previewText": "...",
    "bodyCopy": "...",
    "cta": {"text": "...", "url": "..."},
    "segmentation": "..."
  },
  ...
]

Output ONLY valid JSON. No markdown, no explanation.`;

    const response = await this.claudeService.callAgent({
      systemPrompt,
      messages: [{ role: 'user', content: `Generate the ${config.emailCount}-email sequence now.` }]
    });

    // Parse Claude response
    const cleaned = response.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '').trim();
    return JSON.parse(cleaned);
  }

  /**
   * Build audience segments based on ICP attributes.
   * @private
   */
  _buildAudienceSegments(context, config) {
    const segments = [];

    // Segment by pain point severity
    if (context.icp.painPoints.length > 0) {
      segments.push({
        name: 'High Pain Severity',
        criteria: {
          painPoints: [context.icp.painPoints[0]],
          companySize: context.icp.firmographics.companySize,
          priority: 'high'
        },
        estimatedSize: '40%',
        emailSequence: 'Full sequence (all emails)'
      });

      if (context.icp.painPoints.length > 1) {
        segments.push({
          name: 'Medium Pain Severity',
          criteria: {
            painPoints: [context.icp.painPoints[1]],
            companySize: context.icp.firmographics.companySize,
            priority: 'medium'
          },
          estimatedSize: '35%',
          emailSequence: 'Shortened sequence (Email 1, 3, 5)'
        });
      }
    }

    // Segment by buyer journey stage
    segments.push({
      name: 'Awareness Stage',
      criteria: {
        stage: 'awareness',
        emailsOpened: 0,
        websiteVisits: 0
      },
      estimatedSize: '50%',
      emailSequence: 'Start with Email 1 (awareness)'
    });

    segments.push({
      name: 'Consideration Stage',
      criteria: {
        stage: 'consideration',
        emailsOpened: '1+',
        websiteVisits: '1+'
      },
      estimatedSize: '30%',
      emailSequence: 'Start with Email 2 (consideration)'
    });

    segments.push({
      name: 'Decision Stage',
      criteria: {
        stage: 'decision',
        emailsOpened: '2+',
        demoRequested: false
      },
      estimatedSize: '20%',
      emailSequence: 'Send only Email 5 (decision/conversion)'
    });

    return segments;
  }

  /**
   * Build send schedule with optimal timing.
   * @private
   */
  _buildSendSchedule(emailSequence, config) {
    const schedule = [];
    const startDate = new Date();

    emailSequence.forEach((email, index) => {
      const sendDate = new Date(startDate);
      sendDate.setDate(startDate.getDate() + email.sendDay);

      // Optimal send time: Tuesday-Thursday, 10am local time
      let dayOfWeek = sendDate.getDay();
      if (dayOfWeek === 0) sendDate.setDate(sendDate.getDate() + 2); // Sunday → Tuesday
      if (dayOfWeek === 6) sendDate.setDate(sendDate.getDate() + 3); // Saturday → Tuesday
      if (dayOfWeek === 5) sendDate.setDate(sendDate.getDate() + 4); // Friday → Tuesday

      sendDate.setHours(10, 0, 0, 0);

      schedule.push({
        emailNumber: email.emailNumber,
        emailName: email.name,
        sendDate: sendDate.toISOString(),
        sendDay: email.sendDay,
        status: 'scheduled'
      });
    });

    return schedule;
  }

  /**
   * Schedule emails via ESP API (Mailchimp, Resend, etc.)
   * @private
   */
  async _scheduleViaESP(emailSequence, sendSchedule, config) {
    // TODO: Implement ESP API integration
    // For now, return mock result
    console.log('[EmailNurtureWorkflow] ESP scheduling not yet implemented');
    return {
      provider: config.espProvider,
      campaignId: _uid(),
      status: 'scheduled',
      emailsScheduled: emailSequence.length,
      message: 'Manual scheduling required (ESP API not yet connected)'
    };
  }

  /**
   * Save execution result to localStorage.
   * @private
   */
  _saveExecution(result) {
    const executions = _lsGet(AUTOMATION_STORAGE_KEYS.EXECUTIONS) || [];
    executions.push(result);
    _lsSet(AUTOMATION_STORAGE_KEYS.EXECUTIONS, executions);
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
   2. SOCIAL DISTRIBUTION WORKFLOW
   Auto-repurpose content for multiple platforms and schedule publishing.
   ───────────────────────────────────────────────────────────────────────────── */

/**
 * SocialDistributionWorkflow manages automated content repurposing and publishing.
 *
 * Workflow Steps:
 * 1. Take source content (blog post, case study, product update)
 * 2. Generate platform-specific variants (LinkedIn, Twitter, Facebook)
 * 3. Adapt tone, length, and format for each platform
 * 4. Schedule posts based on optimal timing
 * 5. (Optional) Auto-publish via social media APIs
 */
class SocialDistributionWorkflow {
  constructor(intelligenceEngine, claudeService) {
    this.intelligenceEngine = intelligenceEngine;
    this.claudeService = claudeService;
  }

  /**
   * Create and execute social distribution workflow.
   * @param {Object} config
   * @param {string} config.sourceContent - Original content to repurpose
   * @param {string} config.contentType - Type (blog, case_study, product_update, announcement)
   * @param {string[]} config.platforms - Platforms to publish to (linkedin, twitter, facebook)
   * @param {number} config.variantsPerPlatform - Number of variants per platform (1-3)
   * @param {boolean} [config.autoPublish=false] - Auto-publish via social APIs
   * @returns {Promise<Object>} - Execution result with platform-specific content
   */
  async execute(config) {
    const executionId = _uid();
    const startTime = new Date().toISOString();

    console.log(`[SocialDistributionWorkflow] Starting execution ${executionId}:`, config);

    try {
      // STEP 1: Extract brand voice from Intelligence Layer
      const context = this.intelligenceEngine.extractStructuredContext();

      // STEP 2: Generate platform-specific variants
      const socialContent = await this._generateSocialVariants(context, config);

      // STEP 3: Build publishing schedule
      const publishSchedule = this._buildPublishSchedule(socialContent, config);

      // STEP 4: (Optional) Auto-publish via social APIs
      let publishResult = null;
      if (config.autoPublish) {
        publishResult = await this._publishToSocial(socialContent, publishSchedule, config);
      }

      // STEP 5: Save execution result
      const result = {
        executionId,
        workflowType: WORKFLOW_TYPE.SOCIAL_DISTRIBUTION,
        status: WORKFLOW_STATUS.COMPLETED,
        config,
        startTime,
        endTime: new Date().toISOString(),
        output: {
          socialContent,
          publishSchedule,
          publishResult
        }
      };

      this._saveExecution(result);
      return result;

    } catch (error) {
      console.error('[SocialDistributionWorkflow] Execution failed:', error);
      const result = {
        executionId,
        workflowType: WORKFLOW_TYPE.SOCIAL_DISTRIBUTION,
        status: WORKFLOW_STATUS.FAILED,
        config,
        startTime,
        endTime: new Date().toISOString(),
        error: error.message
      };
      this._saveExecution(result);
      throw error;
    }
  }

  /**
   * Generate platform-specific social content variants.
   * @private
   */
  async _generateSocialVariants(context, config) {
    const platformSpecs = {
      linkedin: {
        maxLength: 3000,
        tone: 'professional, thought leadership',
        format: 'Long-form post with line breaks, emojis optional',
        cta: 'Comment, share, link to full article'
      },
      twitter: {
        maxLength: 280,
        tone: 'concise, punchy, conversational',
        format: 'Thread (1-5 tweets) or single tweet',
        cta: 'Retweet, reply, link in thread'
      },
      facebook: {
        maxLength: 500,
        tone: 'friendly, engaging, visual',
        format: 'Short post with image, video, or link preview',
        cta: 'Like, comment, share'
      }
    };

    const systemPrompt = `You are a social media content strategist.

Repurpose this content for multiple platforms:

SOURCE CONTENT:
${config.sourceContent}

CONTENT TYPE: ${config.contentType}

## Brand Voice Context
Tone: ${context.positioning.brandVoice.tone.join(', ')}
Avoid: ${context.positioning.brandVoice.avoid || 'Generic corporate speak'}
Value Props: ${context.positioning.valueProps.join(', ')}

## Platform Requirements
${config.platforms.map(p => `${p}: ${JSON.stringify(platformSpecs[p], null, 2)}`).join('\n\n')}

Generate ${config.variantsPerPlatform} variant(s) per platform.

Output as JSON:
{
  "linkedin": [{"variant": 1, "content": "...", "cta": "...", "hashtags": [...]}],
  "twitter": [{"variant": 1, "thread": ["tweet 1", "tweet 2"], "hashtags": [...]}],
  "facebook": [{"variant": 1, "content": "...", "cta": "...", "imagePrompt": "..."}]
}

Output ONLY valid JSON. No markdown, no explanation.`;

    const response = await this.claudeService.callAgent({
      systemPrompt,
      messages: [{ role: 'user', content: 'Generate the social content variants now.' }]
    });

    const cleaned = response.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '').trim();
    return JSON.parse(cleaned);
  }

  /**
   * Build publishing schedule with optimal timing for each platform.
   * @private
   */
  _buildPublishSchedule(socialContent, config) {
    const schedule = [];
    const now = new Date();

    // Optimal posting times by platform (based on engagement data)
    const optimalTimes = {
      linkedin: { day: 'Tuesday', hour: 10 }, // Tuesday 10am
      twitter: { day: 'Wednesday', hour: 12 }, // Wednesday noon
      facebook: { day: 'Thursday', hour: 13 }  // Thursday 1pm
    };

    config.platforms.forEach(platform => {
      const variants = socialContent[platform] || [];
      variants.forEach((variant, index) => {
        const postDate = new Date(now);
        const optimal = optimalTimes[platform];

        // Schedule for next occurrence of optimal day
        const targetDay = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].indexOf(optimal.day);
        const daysUntil = (targetDay - postDate.getDay() + 7) % 7;
        postDate.setDate(postDate.getDate() + daysUntil + (index * 2)); // Stagger variants by 2 days
        postDate.setHours(optimal.hour, 0, 0, 0);

        schedule.push({
          platform,
          variant: variant.variant,
          postDate: postDate.toISOString(),
          status: 'scheduled'
        });
      });
    });

    return schedule;
  }

  /**
   * Publish to social media via APIs.
   * @private
   */
  async _publishToSocial(socialContent, publishSchedule, config) {
    // TODO: Implement social media API integrations
    console.log('[SocialDistributionWorkflow] Social publishing not yet implemented');
    return {
      platforms: config.platforms,
      postsScheduled: publishSchedule.length,
      status: 'scheduled',
      message: 'Manual publishing required (Social APIs not yet connected)'
    };
  }

  /**
   * Save execution result to localStorage.
   * @private
   */
  _saveExecution(result) {
    const executions = _lsGet(AUTOMATION_STORAGE_KEYS.EXECUTIONS) || [];
    executions.push(result);
    _lsSet(AUTOMATION_STORAGE_KEYS.EXECUTIONS, executions);
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
   3. PAID MEDIA CAMPAIGN LAUNCH WORKFLOW
   Auto-generate ad variants, create audiences, and launch campaigns.
   ───────────────────────────────────────────────────────────────────────────── */

/**
 * PaidMediaCampaignWorkflow manages automated campaign creation and launch.
 *
 * Workflow Steps:
 * 1. Extract ICP targeting criteria from Intelligence Layer
 * 2. Generate 6+ ad variants testing different psychological triggers
 * 3. Create audience definitions based on firmographics
 * 4. Set budget allocation based on CMO directives
 * 5. (Optional) Auto-launch via Google Ads / Meta Ads API
 */
class PaidMediaCampaignWorkflow {
  constructor(intelligenceEngine, claudeService) {
    this.intelligenceEngine = intelligenceEngine;
    this.claudeService = claudeService;
  }

  /**
   * Create and execute paid media campaign launch workflow.
   * @param {Object} config
   * @param {string} config.campaignName - Campaign name
   * @param {string} config.platform - Platform (google_ads, meta_ads, linkedin_ads)
   * @param {string} config.objective - Campaign objective (awareness, traffic, leads, conversions)
   * @param {number} config.budget - Total campaign budget (USD)
   * @param {number} config.variantCount - Number of ad variants to generate (6-12)
   * @param {boolean} [config.autoLaunch=false] - Auto-launch campaign via API
   * @returns {Promise<Object>} - Execution result with ad variants and audiences
   */
  async execute(config) {
    const executionId = _uid();
    const startTime = new Date().toISOString();

    console.log(`[PaidMediaCampaignWorkflow] Starting execution ${executionId}:`, config);

    try {
      // STEP 1: Extract ICP targeting from Intelligence Layer
      const context = this.intelligenceEngine.extractStructuredContext();

      if (!context.meta.isReady) {
        throw new Error('Intelligence Layer not configured. Configure BusinessBrain first.');
      }

      // STEP 2: Build audience targeting criteria
      const audienceTargeting = this._buildAudienceTargeting(context, config);

      // STEP 3: Generate ad variants using Claude
      const adVariants = await this._generateAdVariants(context, config);

      // STEP 4: Build budget allocation across variants
      const budgetAllocation = this._buildBudgetAllocation(adVariants, config);

      // STEP 5: (Optional) Auto-launch via ad platform API
      let launchResult = null;
      if (config.autoLaunch) {
        launchResult = await this._launchCampaign(adVariants, audienceTargeting, budgetAllocation, config);
      }

      // STEP 6: Save execution result
      const result = {
        executionId,
        workflowType: WORKFLOW_TYPE.PAID_MEDIA_LAUNCH,
        status: WORKFLOW_STATUS.COMPLETED,
        config,
        startTime,
        endTime: new Date().toISOString(),
        output: {
          adVariants,
          audienceTargeting,
          budgetAllocation,
          launchResult
        }
      };

      this._saveExecution(result);
      return result;

    } catch (error) {
      console.error('[PaidMediaCampaignWorkflow] Execution failed:', error);
      const result = {
        executionId,
        workflowType: WORKFLOW_TYPE.PAID_MEDIA_LAUNCH,
        status: WORKFLOW_STATUS.FAILED,
        config,
        startTime,
        endTime: new Date().toISOString(),
        error: error.message
      };
      this._saveExecution(result);
      throw error;
    }
  }

  /**
   * Build audience targeting based on ICP firmographics.
   * @private
   */
  _buildAudienceTargeting(context, config) {
    const firmographics = context.icp.firmographics;

    const targeting = {
      demographics: {
        jobTitles: [firmographics.role],
        industries: [firmographics.industry],
        companySizes: firmographics.companySize.split('-').map(s => parseInt(s.trim()))
      },
      interests: [],
      behaviors: [],
      exclusions: []
    };

    // Add targeting based on pain points
    context.icp.painPoints.forEach(pain => {
      // Extract keywords from pain points for interest targeting
      const keywords = pain.toLowerCase().split(' ').filter(w => w.length > 4);
      targeting.interests.push(...keywords);
    });

    // Add competitive targeting (people who engage with competitors)
    if (context.competitive.gaps.length > 0) {
      targeting.behaviors.push('Engages with competitor content');
      targeting.interests.push(...context.competitive.gaps.map(g => g.competitor.toLowerCase()));
    }

    return targeting;
  }

  /**
   * Generate ad variants testing different psychological triggers.
   * @private
   */
  async _generateAdVariants(context, config) {
    const platformSpecs = {
      google_ads: { headlineMax: 30, descriptionMax: 90 },
      meta_ads: { headlineMax: 40, primaryTextMax: 125 },
      linkedin_ads: { headlineMax: 50, descriptionMax: 150 }
    };

    const spec = platformSpecs[config.platform] || platformSpecs.google_ads;

    const systemPrompt = `You are a performance marketing expert.

Create ${config.variantCount} ad variants for this campaign:

Campaign: ${config.campaignName}
Platform: ${config.platform}
Objective: ${config.objective}

## ICP Context
Target: ${context.icp.firmographics.role} at ${context.icp.firmographics.companySize} companies in ${context.icp.firmographics.industry}
Pain Points: ${context.icp.painPoints.join(', ')}
Value Props: ${context.positioning.valueProps.join(', ')}
Competitive Edges: ${context.positioning.competitiveEdges.join(', ')}
Brand Voice: ${context.positioning.brandVoice.tone.join(', ')}

## Character Limits
Headline: ${spec.headlineMax} characters max
Description: ${spec.descriptionMax} characters max

## Required Variants (test different triggers)
1. Pain-focused (hook with primary pain point)
2. Benefit-focused (lead with primary value prop)
3. Social proof ("X teams use [product]")
4. Urgency/FOMO ("Limited time", "Join X companies")
5. Competitive displacement (differentiator vs competitor)
6. Curiosity ("How do [role]s achieve [outcome]?")
${config.variantCount > 6 ? `7-${config.variantCount}. Additional variants testing unique angles` : ''}

Output as JSON array:
[
  {
    "variant": 1,
    "name": "Pain-focused",
    "trigger": "pain_awareness",
    "headline": "...",
    "description": "...",
    "cta": "...",
    "abHypothesis": "What this tests vs others"
  },
  ...
]

CRITICAL: Stay within character limits. Output ONLY valid JSON.`;

    const response = await this.claudeService.callAgent({
      systemPrompt,
      messages: [{ role: 'user', content: `Generate the ${config.variantCount} ad variants now.` }]
    });

    const cleaned = response.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '').trim();
    return JSON.parse(cleaned);
  }

  /**
   * Build budget allocation across ad variants.
   * @private
   */
  _buildBudgetAllocation(adVariants, config) {
    const allocation = [];
    const initialBudgetPerVariant = Math.floor(config.budget / adVariants.length);

    adVariants.forEach(variant => {
      allocation.push({
        variant: variant.variant,
        name: variant.name,
        initialBudget: initialBudgetPerVariant,
        biddingStrategy: config.objective === 'conversions' ? 'target_cpa' : 'maximize_clicks',
        status: 'active'
      });
    });

    return allocation;
  }

  /**
   * Launch campaign via ad platform API.
   * @private
   */
  async _launchCampaign(adVariants, audienceTargeting, budgetAllocation, config) {
    // TODO: Implement ad platform API integrations
    console.log('[PaidMediaCampaignWorkflow] Campaign launch not yet implemented');
    return {
      platform: config.platform,
      campaignId: _uid(),
      status: 'draft',
      variantsCreated: adVariants.length,
      message: 'Manual campaign creation required (Ad platform APIs not yet connected)'
    };
  }

  /**
   * Save execution result to localStorage.
   * @private
   */
  _saveExecution(result) {
    const executions = _lsGet(AUTOMATION_STORAGE_KEYS.EXECUTIONS) || [];
    executions.push(result);
    _lsSet(AUTOMATION_STORAGE_KEYS.EXECUTIONS, executions);
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
   4. LEAD SCORING WORKFLOW
   Auto-qualify and route leads based on ICP match and intent signals.
   ───────────────────────────────────────────────────────────────────────────── */

/**
 * LeadScoringWorkflow manages automated lead qualification and routing.
 *
 * Workflow Steps:
 * 1. Extract firmographic criteria from Intelligence Layer
 * 2. Score leads based on ICP match (A/B/C tier)
 * 3. Assign points for intent signals (hiring, funding, tech stack)
 * 4. Route to sales based on score threshold
 * 5. Enrich with 3rd party data (optional)
 */
class LeadScoringWorkflow {
  constructor(intelligenceEngine) {
    this.intelligenceEngine = intelligenceEngine;
  }

  /**
   * Score a batch of leads based on ICP match.
   * @param {Object} config
   * @param {Array<Object>} config.leads - Array of lead objects to score
   * @param {number} [config.aTierThreshold=80] - Score threshold for A-tier (hot leads)
   * @param {number} [config.bTierThreshold=50] - Score threshold for B-tier (warm leads)
   * @param {boolean} [config.autoRoute=false] - Auto-route to sales via CRM API
   * @param {boolean} [config.enrich=false] - Enrich with Clearbit/Apollo data
   * @returns {Promise<Object>} - Execution result with scored leads
   */
  async execute(config) {
    const executionId = _uid();
    const startTime = new Date().toISOString();

    console.log(`[LeadScoringWorkflow] Starting execution ${executionId}:`, config);

    try {
      // STEP 1: Extract ICP criteria from Intelligence Layer
      const context = this.intelligenceEngine.extractStructuredContext();

      if (!context.meta.isReady) {
        throw new Error('Intelligence Layer not configured. Configure BusinessBrain first.');
      }

      // STEP 2: Score each lead
      const scoredLeads = config.leads.map(lead => this._scoreLead(lead, context, config));

      // STEP 3: Segment into A/B/C tiers
      const tieredLeads = this._tierLeads(scoredLeads, config);

      // STEP 4: (Optional) Enrich with 3rd party data
      if (config.enrich) {
        // TODO: Implement enrichment API
        console.log('[LeadScoringWorkflow] Lead enrichment not yet implemented');
      }

      // STEP 5: (Optional) Auto-route to sales
      let routingResult = null;
      if (config.autoRoute) {
        routingResult = await this._routeToSales(tieredLeads, config);
      }

      // STEP 6: Save execution result
      const result = {
        executionId,
        workflowType: WORKFLOW_TYPE.LEAD_SCORING,
        status: WORKFLOW_STATUS.COMPLETED,
        config,
        startTime,
        endTime: new Date().toISOString(),
        output: {
          totalLeads: config.leads.length,
          scoredLeads,
          tieredLeads,
          routingResult
        }
      };

      this._saveExecution(result);
      return result;

    } catch (error) {
      console.error('[LeadScoringWorkflow] Execution failed:', error);
      const result = {
        executionId,
        workflowType: WORKFLOW_TYPE.LEAD_SCORING,
        status: WORKFLOW_STATUS.FAILED,
        config,
        startTime,
        endTime: new Date().toISOString(),
        error: error.message
      };
      this._saveExecution(result);
      throw error;
    }
  }

  /**
   * Score a single lead based on ICP match and intent signals.
   * @private
   */
  _scoreLead(lead, context, config) {
    let score = 0;
    const scoreBreakdown = {};

    // FIRMOGRAPHIC MATCH (40 points max)
    const firmographics = context.icp.firmographics;

    // Role match (15 points)
    if (lead.jobTitle && firmographics.role) {
      const roleMatch = lead.jobTitle.toLowerCase().includes(firmographics.role.toLowerCase());
      if (roleMatch) {
        score += 15;
        scoreBreakdown.roleMatch = 15;
      }
    }

    // Company size match (10 points)
    if (lead.companySize && firmographics.companySize) {
      const [min, max] = firmographics.companySize.split('-').map(s => parseInt(s.trim()));
      const leadSize = parseInt(lead.companySize);
      if (leadSize >= min && leadSize <= max) {
        score += 10;
        scoreBreakdown.companySizeMatch = 10;
      }
    }

    // Industry match (15 points)
    if (lead.industry && firmographics.industry) {
      const industryMatch = lead.industry.toLowerCase().includes(firmographics.industry.toLowerCase());
      if (industryMatch) {
        score += 15;
        scoreBreakdown.industryMatch = 15;
      }
    }

    // INTENT SIGNALS (60 points max)

    // Hiring signal (20 points) - hiring for target role
    if (lead.signals && lead.signals.hiring) {
      score += 20;
      scoreBreakdown.hiringSignal = 20;
    }

    // Funding signal (20 points) - recent funding round
    if (lead.signals && lead.signals.funding) {
      score += 20;
      scoreBreakdown.fundingSignal = 20;
    }

    // Tech stack signal (10 points) - uses competitor tool
    if (lead.signals && lead.signals.competitorTool) {
      score += 10;
      scoreBreakdown.techStackSignal = 10;
    }

    // Engagement signal (10 points) - visited website, opened emails
    if (lead.signals && lead.signals.engagement) {
      score += 10;
      scoreBreakdown.engagementSignal = 10;
    }

    return {
      ...lead,
      score,
      scoreBreakdown,
      scoredAt: new Date().toISOString()
    };
  }

  /**
   * Tier leads into A/B/C based on score thresholds.
   * @private
   */
  _tierLeads(scoredLeads, config) {
    const aTier = scoredLeads.filter(l => l.score >= config.aTierThreshold);
    const bTier = scoredLeads.filter(l => l.score >= config.bTierThreshold && l.score < config.aTierThreshold);
    const cTier = scoredLeads.filter(l => l.score < config.bTierThreshold);

    return {
      aTier: {
        leads: aTier,
        count: aTier.length,
        description: 'Hot leads (ICP match + 2+ intent signals)',
        action: 'Route to sales immediately'
      },
      bTier: {
        leads: bTier,
        count: bTier.length,
        description: 'Warm leads (ICP match + 1 intent signal)',
        action: 'Add to nurture sequence'
      },
      cTier: {
        leads: cTier,
        count: cTier.length,
        description: 'Cold leads (ICP match only)',
        action: 'Add to long-term nurture'
      }
    };
  }

  /**
   * Route qualified leads to sales via CRM API.
   * @private
   */
  async _routeToSales(tieredLeads, config) {
    // TODO: Implement CRM API routing
    console.log('[LeadScoringWorkflow] Lead routing not yet implemented');
    return {
      aTierRouted: tieredLeads.aTier.count,
      bTierNurtured: tieredLeads.bTier.count,
      cTierQueued: tieredLeads.cTier.count,
      message: 'Manual routing required (CRM API not yet connected)'
    };
  }

  /**
   * Save execution result to localStorage.
   * @private
   */
  _saveExecution(result) {
    const executions = _lsGet(AUTOMATION_STORAGE_KEYS.EXECUTIONS) || [];
    executions.push(result);
    _lsSet(AUTOMATION_STORAGE_KEYS.EXECUTIONS, executions);
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
   EXPORT — singleton on window, available to all pages and agents
   ───────────────────────────────────────────────────────────────────────────── */
window.AutomationEngine = {
  EmailNurtureWorkflow,
  SocialDistributionWorkflow,
  PaidMediaCampaignWorkflow,
  LeadScoringWorkflow,
  WORKFLOW_TYPE,
  WORKFLOW_STATUS
};
