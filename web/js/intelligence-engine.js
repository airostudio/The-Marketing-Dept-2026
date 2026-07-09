/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * INTELLIGENCE ENGINE — Audema - Your AI Marketing Department
 * The upstream judgment layer. Runs BEFORE any content agent executes.
 *
 * This module manages four intelligence stores:
 *   1. BusinessBrain     — deep company / ICP / positioning context
 *   2. CompetitiveRadar  — competitor moves, messaging, gaps
 *   3. MarketPulse       — signals: what's working in the space right now
 *   4. StrategicBriefs   — "why" rationale generated before any execution
 *
 * Every agent execution should pull from IntelligenceEngine.getContextBundle()
 * before composing its system prompt.
 *
 * Zero fake data — all data comes from user input processed through Claude.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

'use strict';

/* ─────────────────────────────────────────────────────────────────────────────
   CONSTANTS & STORAGE KEYS
   ───────────────────────────────────────────────────────────────────────────── */

/** @enum {string} localStorage keys for each intelligence store */
const STORAGE_KEYS = {
  BUSINESS_BRAIN:     'intel_business_brain',
  COMPETITIVE_RADAR:  'intel_competitive_radar',
  MARKET_PULSE:       'intel_market_pulse',
  STRATEGIC_BRIEFS:   'intel_strategic_briefs',
  SIGNALS:            'intel_signals'
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
    console.warn('[IntelligenceEngine] localStorage read failed:', e.message);
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
    console.warn('[IntelligenceEngine] localStorage write failed:', e.message);
  }
}

/**
 * Resolve a dot-path string against an object and set the leaf value.
 * Mutates the object in place.
 * @param {Object} obj   - root object to mutate
 * @param {string} path  - dot-separated key path, e.g. 'icp.painPoints'
 * @param {*}      value - value to set at the leaf
 */
function _setByPath(obj, path, value) {
  const keys = path.split('.');
  let cursor = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    if (typeof cursor[k] !== 'object' || cursor[k] === null) cursor[k] = {};
    cursor = cursor[k];
  }
  cursor[keys[keys.length - 1]] = value;
}

/* ─────────────────────────────────────────────────────────────────────────────
   1. BUSINESS BRAIN
   Stores the deep strategic foundation: company, ICP, positioning, competitors,
   and objectives. This is the "who we are and who we serve" layer.
   ───────────────────────────────────────────────────────────────────────────── */

/**
 * BusinessBrain manages the core company and market context.
 *
 * Schema stored:
 * {
 *   company: {
 *     name, tagline, description, industry, stage, founded, teamSize,
 *     revenueModel
 *   },
 *   icp: {
 *     primaryBuyer: { role, companySize, industry },
 *     painPoints: string[],
 *     language: string[],
 *     triedBefore: string,
 *     reasonChose: string,
 *     biggestFear: string,
 *     buyerJourney: { aware: string, consider: string, decide: string }
 *   },
 *   positioning: {
 *     uniqueValue: string,
 *     differentiation: string[],
 *     voiceAndTone: string[],
 *     thingsWeNeverSay: string,
 *     notLikeCompetitors: string
 *   },
 *   competitors: [{
 *     name, url, positioning, theyAreStrongAt: [], theyAreWeakAt: [],
 *     recentMoves: [], borrowAndImprove: string
 *   }],
 *   objectives: {
 *     q1Focus, annualGoal, currentChallenge, bestContentHistorically,
 *     bestLeadChannels: []
 *   },
 *   intelligence: { lastUpdated: ISO string, confidenceScore: 0-100 }
 * }
 */
class BusinessBrain {
  constructor() {
    /** @private legacy global key, kept for one-time migration detection */
    this._legacyKey = STORAGE_KEYS.BUSINESS_BRAIN;
  }

  /**
   * Per-project storage key. Falls back to a 'default' bucket when no
   * project is selected (e.g. brand-new account before first project).
   * Reads the same current-project pointer project-service.js maintains,
   * so Business Brain data is isolated per project instead of one shared
   * brain across the whole account.
   * @returns {string}
   * @private
   */
  _key() {
    const projectId = localStorage.getItem('seo-current-project');
    return `${STORAGE_KEYS.BUSINESS_BRAIN}__${projectId || 'default'}`;
  }

  /**
   * The current project ID this brain instance is scoped to, or null.
   * @returns {string|null}
   */
  currentProjectId() {
    return localStorage.getItem('seo-current-project');
  }

  /**
   * Return the empty scaffold used when no data has been stored yet.
   * @returns {Object}
   * @private
   */
  _emptyScaffold() {
    return {
      company: {
        name: '',
        tagline: '',
        description: '',
        industry: '',
        stage: '',
        founded: '',
        teamSize: '',
        revenueModel: ''
      },
      icp: {
        primaryBuyer: { role: '', companySize: '', industry: '' },
        painPoints: ['', '', ''],
        language: [],
        triedBefore: '',
        reasonChose: '',
        biggestFear: '',
        buyerJourney: { aware: '', consider: '', decide: '' }
      },
      positioning: {
        uniqueValue: '',
        differentiation: ['', '', ''],
        voiceAndTone: [],
        thingsWeNeverSay: '',
        notLikeCompetitors: ''
      },
      competitors: [],
      objectives: {
        q1Focus: '',
        annualGoal: '',
        currentChallenge: '',
        bestContentHistorically: '',
        bestLeadChannels: []
      },
      intelligence: {
        lastUpdated: null,
        confidenceScore: 0
      }
    };
  }

  /**
   * Persist the brain data to localStorage (instant, synchronous) and mirror
   * it to Supabase in the background (per-project, versioned history).
   * Automatically stamps lastUpdated.
   * @param {Object} data
   * @param {string} [label] - optional history label, e.g. 'Autofill overwrite'
   * @returns {Object} the saved data
   */
  save(data, label) {
    if (typeof data !== 'object' || data === null) {
      throw new TypeError('[BusinessBrain.save] data must be a non-null object');
    }
    // Stamp update time and refresh confidence score
    if (!data.intelligence) data.intelligence = {};
    data.intelligence.lastUpdated = new Date().toISOString();
    data.intelligence.confidenceScore = this._computeConfidence(data);

    _lsSet(this._key(), data);

    // Fire-and-forget cloud sync — never blocks or throws on the caller.
    const projectId = this.currentProjectId();
    if (window.BusinessBrainCloud && projectId) {
      window.BusinessBrainCloud
        .pushSnapshot(projectId, data, data.intelligence.confidenceScore, label)
        .catch(() => {});
    }

    return data;
  }

  /**
   * Load the stored brain, falling back to an empty scaffold.
   * @returns {Object}
   */
  load() {
    return _lsGet(this._key()) || this._emptyScaffold();
  }

  /**
   * Write data to the local cache WITHOUT pushing a new cloud snapshot —
   * used after a history restore, where the cloud snapshot has already been
   * recorded by BusinessBrainCloud.restoreSnapshot(). Avoids a duplicate
   * "Autosave" entry immediately after the "Restored from ..." entry.
   * @param {Object} data
   * @returns {Object}
   */
  applyRestoredData(data) {
    _lsSet(this._key(), data);
    return data;
  }

  /**
   * Pull the latest cloud copy for the current project and hydrate the local
   * cache with it if the cloud copy is newer. Call once on page load — this
   * is async and does not block synchronous load()/save() call sites.
   * @returns {Promise<Object|null>} the hydrated data, or null if nothing pulled
   */
  async hydrateFromCloud() {
    const projectId = this.currentProjectId();
    if (!window.BusinessBrainCloud || !projectId) return null;

    const cloud = await window.BusinessBrainCloud.pullLatest(projectId);
    if (!cloud || !cloud.data) return null;

    const local = _lsGet(this._key());
    const cloudUpdated = new Date(cloud.updated_at || 0).getTime();
    const localUpdated = new Date(local?.intelligence?.lastUpdated || 0).getTime();

    // Only overwrite local cache if the cloud copy is strictly newer —
    // protects against a stale cloud pull clobbering a fresher local edit.
    if (cloudUpdated > localUpdated) {
      _lsSet(this._key(), cloud.data);
      return cloud.data;
    }
    return local;
  }

  /**
   * Update a single field by dot-path, then persist.
   * @param {string} path  - e.g. 'icp.painPoints', 'company.name'
   * @param {*}      value - the new value for that path
   * @returns {Object} full updated brain
   */
  update(path, value) {
    if (typeof path !== 'string' || !path.trim()) {
      throw new TypeError('[BusinessBrain.update] path must be a non-empty string');
    }
    const data = this.load();
    _setByPath(data, path, value);
    return this.save(data);
  }

  /**
   * Return a compact string suitable for injecting into a Claude system prompt.
   * Only includes fields that have been filled in.
   * @returns {string}
   */
  getContextSummary() {
    const d = this.load();
    const lines = [];

    if (d.company.name)        lines.push(`Company: ${d.company.name}`);
    if (d.company.tagline)     lines.push(`Tagline: ${d.company.tagline}`);
    if (d.company.description) lines.push(`What we do: ${d.company.description}`);
    if (d.company.industry)    lines.push(`Industry: ${d.company.industry} | Stage: ${d.company.stage}`);
    if (d.company.revenueModel) lines.push(`Revenue model: ${d.company.revenueModel}`);

    const b = d.icp.primaryBuyer;
    if (b.role) {
      lines.push(`\nIdeal Customer: ${b.role} at ${b.companySize || 'any size'} ${b.industry || ''} company`);
    }

    const pains = (d.icp.painPoints || []).filter(p => p && p.trim());
    if (pains.length) {
      lines.push(`Their pain points: ${pains.join(' | ')}`);
    }
    if (d.icp.reasonChose)  lines.push(`Why they chose us: ${d.icp.reasonChose}`);
    if (d.icp.biggestFear)  lines.push(`Their biggest fear: ${d.icp.biggestFear}`);
    if (d.icp.triedBefore)  lines.push(`What they tried before: ${d.icp.triedBefore}`);

    if (d.positioning.uniqueValue) lines.push(`\nValue proposition: ${d.positioning.uniqueValue}`);
    const diffs = (d.positioning.differentiation || []).filter(x => x && x.trim());
    if (diffs.length) lines.push(`Differentiators: ${diffs.join(' | ')}`);
    if (d.positioning.voiceAndTone && d.positioning.voiceAndTone.length) {
      lines.push(`Voice & tone: ${d.positioning.voiceAndTone.join(', ')}`);
    }
    if (d.positioning.thingsWeNeverSay) {
      lines.push(`Things we NEVER say: ${d.positioning.thingsWeNeverSay}`);
    }
    if (d.positioning.notLikeCompetitors) {
      lines.push(`How we differ from competitor messaging: ${d.positioning.notLikeCompetitors}`);
    }

    if (d.objectives.q1Focus) lines.push(`\nQ1 focus: ${d.objectives.q1Focus}`);
    if (d.objectives.annualGoal) lines.push(`12-month goal: ${d.objectives.annualGoal}`);
    if (d.objectives.currentChallenge) lines.push(`Biggest marketing challenge: ${d.objectives.currentChallenge}`);

    if (!lines.length) return 'No business context configured yet.';
    return lines.join('\n');
  }

  /**
   * Returns true if the brain has enough data to be useful to agents.
   * Requires at minimum: company name, description, ICP role, and one pain point.
   * @returns {boolean}
   */
  isConfigured() {
    const d = this.load();
    return !!(
      d.company.name &&
      d.company.description &&
      d.icp.primaryBuyer.role &&
      (d.icp.painPoints || []).some(p => p && p.trim())
    );
  }

  /**
   * Returns a 0-100 completion score based on how many fields are filled.
   * @returns {number}
   */
  getCompletionScore() {
    const d = this.load();
    return this._computeConfidence(d);
  }

  /**
   * Internal scoring logic. Counts filled fields against a weighted checklist.
   * @param {Object} data
   * @returns {number} 0-100
   * @private
   */
  _computeConfidence(data) {
    const checks = [
      // Company basics — weight 25
      { val: data.company?.name,         weight: 5 },
      { val: data.company?.tagline,      weight: 4 },
      { val: data.company?.description,  weight: 6 },
      { val: data.company?.industry,     weight: 4 },
      { val: data.company?.stage,        weight: 3 },
      { val: data.company?.revenueModel, weight: 3 },

      // ICP — weight 30
      { val: data.icp?.primaryBuyer?.role,       weight: 6 },
      { val: data.icp?.primaryBuyer?.companySize, weight: 3 },
      { val: data.icp?.painPoints?.[0],           weight: 5 },
      { val: data.icp?.painPoints?.[1],           weight: 4 },
      { val: data.icp?.painPoints?.[2],           weight: 3 },
      { val: data.icp?.reasonChose,               weight: 5 },
      { val: data.icp?.biggestFear,               weight: 4 },

      // Positioning — weight 25
      { val: data.positioning?.uniqueValue,            weight: 8 },
      { val: data.positioning?.differentiation?.[0],   weight: 5 },
      { val: data.positioning?.differentiation?.[1],   weight: 4 },
      { val: data.positioning?.differentiation?.[2],   weight: 3 },
      { val: data.positioning?.voiceAndTone?.length,   weight: 3 },
      { val: data.positioning?.thingsWeNeverSay,       weight: 2 },

      // Objectives — weight 20
      { val: data.objectives?.q1Focus,                 weight: 6 },
      { val: data.objectives?.annualGoal,              weight: 6 },
      { val: data.objectives?.currentChallenge,        weight: 4 },
      { val: data.objectives?.bestLeadChannels?.length, weight: 4 },

      // Traction & Social Proof — weight 15
      { val: data.metrics?.arr,                        weight: 4 },
      { val: data.metrics?.customers,                  weight: 3 },
      { val: data.metrics?.growth_rate,                weight: 3 },
      { val: data.customers?.length,                   weight: 3 },
      { val: data.testimonials?.length,                weight: 2 }
    ];

    const totalWeight = checks.reduce((s, c) => s + c.weight, 0);
    const earned = checks.reduce((s, c) => {
      const filled = c.val && (typeof c.val === 'number' ? c.val > 0 : String(c.val).trim().length > 0);
      return s + (filled ? c.weight : 0);
    }, 0);

    return Math.round((earned / totalWeight) * 100);
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
   2. COMPETITIVE RADAR
   Tracks competitor profiles, their moves, borrowed ideas, and identified gaps.
   ───────────────────────────────────────────────────────────────────────────── */

/**
 * CompetitiveRadar tracks the external competitive landscape.
 *
 * Schema:
 * {
 *   competitors: [{
 *     id: string,
 *     name: string,
 *     url: string,
 *     addedAt: ISO string,
 *     profile: {
 *       positioning: string,
 *       targetAudience: string,
 *       keyMessages: string[],
 *       tone: string
 *     },
 *     recentMoves: [{
 *       id, date, type: 'content'|'product'|'pricing'|'messaging'|'campaign',
 *       description, sourceUrl, analysis
 *     }],
 *     borrowedIdeas: [{ id, idea, rationale, appliedTo }],
 *     gaps: [{ id, gap, opportunity, priority: 'high'|'medium'|'low' }]
 *   }]
 * }
 */
class CompetitiveRadar {
  constructor() {
    /** @private */
    this._key = STORAGE_KEYS.COMPETITIVE_RADAR;
  }

  /** @private */
  _load() {
    return _lsGet(this._key) || { competitors: [] };
  }

  /** @private */
  _save(data) {
    _lsSet(this._key, data);
    return data;
  }

  /**
   * Add a new competitor to the radar.
   * @param {string} name
   * @param {string} [url]
   * @returns {Object} the new competitor record
   */
  addCompetitor(name, url = '') {
    if (!name || !name.trim()) throw new TypeError('[CompetitiveRadar.addCompetitor] name is required');
    const data = this._load();
    const competitor = {
      id: _uid(),
      name: name.trim(),
      url: url.trim(),
      addedAt: new Date().toISOString(),
      profile: {
        positioning: '',
        targetAudience: '',
        keyMessages: [],
        tone: ''
      },
      recentMoves: [],
      borrowedIdeas: [],
      gaps: []
    };
    data.competitors.push(competitor);
    this._save(data);
    return competitor;
  }

  /**
   * Update a competitor's full profile.
   * @param {string} competitorId
   * @param {Object} profileData - partial or full profile fields
   * @returns {Object|null} updated competitor or null if not found
   */
  updateProfile(competitorId, profileData) {
    const data = this._load();
    const comp = data.competitors.find(c => c.id === competitorId);
    if (!comp) {
      console.warn(`[CompetitiveRadar.updateProfile] competitor ${competitorId} not found`);
      return null;
    }
    Object.assign(comp.profile, profileData);
    this._save(data);
    return comp;
  }

  /**
   * Log a observed competitor move.
   * @param {string} competitorId
   * @param {Object} move - { type, description, sourceUrl?, analysis? }
   * @returns {Object|null} the new move record or null
   */
  addMove(competitorId, move) {
    if (!move || !move.description) throw new TypeError('[CompetitiveRadar.addMove] move.description is required');
    const data = this._load();
    const comp = data.competitors.find(c => c.id === competitorId);
    if (!comp) {
      console.warn(`[CompetitiveRadar.addMove] competitor ${competitorId} not found`);
      return null;
    }
    const record = {
      id: _uid(),
      date: new Date().toISOString(),
      type: move.type || 'content',
      description: move.description.trim(),
      sourceUrl: move.sourceUrl || '',
      analysis: move.analysis || ''
    };
    comp.recentMoves.push(record);
    this._save(data);
    return record;
  }

  /**
   * Record an idea borrowed from a competitor that we intend to do better.
   * @param {string} competitorId
   * @param {Object} idea - { idea, rationale, appliedTo? }
   * @returns {Object|null}
   */
  addBorrowedIdea(competitorId, idea) {
    if (!idea || !idea.idea) throw new TypeError('[CompetitiveRadar.addBorrowedIdea] idea.idea is required');
    const data = this._load();
    const comp = data.competitors.find(c => c.id === competitorId);
    if (!comp) return null;

    const record = {
      id: _uid(),
      idea: idea.idea.trim(),
      rationale: idea.rationale || '',
      appliedTo: idea.appliedTo || ''
    };
    comp.borrowedIdeas.push(record);
    this._save(data);
    return record;
  }

  /**
   * Record an identified market gap from competitive analysis.
   * @param {string} competitorId
   * @param {Object} gap - { gap, opportunity, priority: 'high'|'medium'|'low' }
   * @returns {Object|null}
   */
  addGap(competitorId, gap) {
    if (!gap || !gap.gap) throw new TypeError('[CompetitiveRadar.addGap] gap.gap is required');
    const data = this._load();
    const comp = data.competitors.find(c => c.id === competitorId);
    if (!comp) return null;

    const validPriorities = ['high', 'medium', 'low'];
    const record = {
      id: _uid(),
      gap: gap.gap.trim(),
      opportunity: gap.opportunity || '',
      priority: validPriorities.includes(gap.priority) ? gap.priority : 'medium'
    };
    comp.gaps.push(record);
    this._save(data);
    return record;
  }

  /**
   * Return all competitors.
   * @returns {Object[]}
   */
  getAll() {
    return this._load().competitors;
  }

  /** @returns {boolean} true if at least one competitor has been added */
  hasData() {
    return this._load().competitors.length > 0;
  }

  /**
   * Return a single competitor by ID.
   * @param {string} id
   * @returns {Object|undefined}
   */
  getCompetitor(id) {
    return this._load().competitors.find(c => c.id === id);
  }

  /**
   * Remove a competitor from the radar.
   * @param {string} id
   * @returns {boolean} true if removed
   */
  removeCompetitor(id) {
    const data = this._load();
    const before = data.competitors.length;
    data.competitors = data.competitors.filter(c => c.id !== id);
    this._save(data);
    return data.competitors.length < before;
  }

  /**
   * Return a compact competitive landscape string for Claude system prompts.
   * @returns {string}
   */
  getSummaryForClaude() {
    const competitors = this.getAll();
    if (!competitors.length) return 'No competitors tracked yet.';

    return competitors.map(c => {
      const lines = [`Competitor: ${c.name}${c.url ? ' (' + c.url + ')' : ''}`];
      if (c.profile.positioning) lines.push(`  Their positioning: ${c.profile.positioning}`);

      const msgs = (c.profile.keyMessages || []).filter(m => m && m.trim());
      if (msgs.length) lines.push(`  Key messages: ${msgs.join(' | ')}`);

      const gaps = c.gaps.filter(g => g.priority === 'high').map(g => g.opportunity || g.gap);
      if (gaps.length) lines.push(`  High-priority gaps we can exploit: ${gaps.join(' | ')}`);

      const borrowed = c.borrowedIdeas.map(b => b.idea);
      if (borrowed.length) lines.push(`  Ideas to borrow & improve: ${borrowed.join(' | ')}`);

      return lines.join('\n');
    }).join('\n\n');
  }

  /**
   * Return moves logged within the last N days across all competitors.
   * @param {number} [days=7]
   * @returns {Array<{competitor: string, move: Object}>}
   */
  getRecentMoves(days = 7) {
    const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
    const results = [];
    for (const comp of this.getAll()) {
      for (const move of (comp.recentMoves || [])) {
        if (new Date(move.date).getTime() >= cutoff) {
          results.push({ competitor: comp.name, move });
        }
      }
    }
    return results.sort((a, b) => new Date(b.move.date) - new Date(a.move.date));
  }

  /**
   * Return all gaps across all competitors sorted by priority (high first).
   * @returns {Array<{competitor: string, gap: Object}>}
   */
  getTopGaps() {
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    const results = [];
    for (const comp of this.getAll()) {
      for (const gap of (comp.gaps || [])) {
        results.push({ competitor: comp.name, gap });
      }
    }
    return results.sort((a, b) => (priorityOrder[a.gap.priority] || 2) - (priorityOrder[b.gap.priority] || 2));
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
   3. MARKET PULSE
   Captures and curates "what's working" signals from the market: formats,
   messages, channels, audiences, gaps, and trends observed in the wild.
   ───────────────────────────────────────────────────────────────────────────── */

/**
 * MarketPulse tracks live market signals that inform what to create and how.
 *
 * Schema:
 * {
 *   signals: [{
 *     id: string,
 *     date: ISO string,
 *     type: 'format'|'message'|'channel'|'audience'|'gap'|'trend',
 *     description: string,
 *     evidence: string,
 *     strength: 'strong'|'moderate'|'weak',
 *     sourceType: 'competitor_content'|'industry_article'|'customer_feedback'|
 *                 'ad_observation'|'social_observation',
 *     relevance: 'direct'|'adjacent'|'peripheral',
 *     tags: string[]
 *   }],
 *   weeklyDigests: [{
 *     weekOf: ISO string,
 *     topSignals: string[],
 *     recommendation: string
 *   }]
 * }
 */
class MarketPulse {
  constructor() {
    /** @private */
    this._key = STORAGE_KEYS.MARKET_PULSE;
  }

  /** @private */
  _load() {
    return _lsGet(this._key) || { signals: [], weeklyDigests: [] };
  }

  /** @private */
  _save(data) {
    _lsSet(this._key, data);
    return data;
  }

  /**
   * Log a new market signal.
   * @param {Object} signal
   * @param {string} signal.type        - 'format'|'message'|'channel'|'audience'|'gap'|'trend'
   * @param {string} signal.description - what you observed
   * @param {string} [signal.evidence]  - supporting evidence or source link
   * @param {string} [signal.strength]  - 'strong'|'moderate'|'weak'
   * @param {string} [signal.sourceType]
   * @param {string} [signal.relevance] - 'direct'|'adjacent'|'peripheral'
   * @param {string[]} [signal.tags]
   * @returns {Object} the saved signal record
   */
  addSignal(signal) {
    if (!signal || !signal.description) {
      throw new TypeError('[MarketPulse.addSignal] signal.description is required');
    }

    const validTypes      = ['format', 'message', 'channel', 'audience', 'gap', 'trend'];
    const validStrengths  = ['strong', 'moderate', 'weak'];
    const validSources    = ['competitor_content', 'industry_article', 'customer_feedback',
                             'ad_observation', 'social_observation'];
    const validRelevances = ['direct', 'adjacent', 'peripheral'];

    const record = {
      id:          _uid(),
      date:        new Date().toISOString(),
      type:        validTypes.includes(signal.type) ? signal.type : 'trend',
      description: signal.description.trim(),
      evidence:    signal.evidence || '',
      strength:    validStrengths.includes(signal.strength) ? signal.strength : 'moderate',
      sourceType:  validSources.includes(signal.sourceType) ? signal.sourceType : 'industry_article',
      relevance:   validRelevances.includes(signal.relevance) ? signal.relevance : 'direct',
      tags:        Array.isArray(signal.tags) ? signal.tags : []
    };

    const data = this._load();
    data.signals.push(record);
    this._save(data);
    return record;
  }

  /**
   * Return signals optionally filtered by type, strength, and/or date range.
   * @param {Object} [filter]
   * @param {string}   [filter.type]
   * @param {string}   [filter.strength]
   * @param {string}   [filter.relevance]
   * @param {number}   [filter.afterMs]  - only signals after this epoch ms
   * @param {string[]} [filter.tags]     - signals must include at least one
   * @returns {Object[]}
   */
  getSignals(filter = {}) {
    let signals = this._load().signals;

    if (filter.type)      signals = signals.filter(s => s.type === filter.type);
    if (filter.strength)  signals = signals.filter(s => s.strength === filter.strength);
    if (filter.relevance) signals = signals.filter(s => s.relevance === filter.relevance);
    if (filter.afterMs)   signals = signals.filter(s => new Date(s.date).getTime() >= filter.afterMs);
    if (filter.tags && filter.tags.length) {
      signals = signals.filter(s => filter.tags.some(t => s.tags.includes(t)));
    }

    return signals.sort((a, b) => new Date(b.date) - new Date(a.date));
  }

  /**
   * Return signals from the last 30 days.
   * @returns {Object[]}
   */
  getActiveSignals() {
    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
    return this.getSignals({ afterMs: thirtyDaysAgo });
  }

  /** @returns {boolean} true if at least one signal has been logged */
  hasData() {
    return this._load().signals.length > 0;
  }

  /**
   * Return the N highest-strength signals from the last 30 days.
   * Strength sort order: strong > moderate > weak.
   * @param {number} [n=5]
   * @returns {Object[]}
   */
  getTopSignals(n = 5) {
    const strengthOrder = { strong: 0, moderate: 1, weak: 2 };
    return this.getActiveSignals()
      .sort((a, b) => (strengthOrder[a.strength] || 2) - (strengthOrder[b.strength] || 2))
      .slice(0, n);
  }

  /**
   * Build and store a weekly digest from signals in the current week.
   * @returns {Object} the digest record
   */
  generateWeeklyDigest() {
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay()); // Sunday
    weekStart.setHours(0, 0, 0, 0);

    const weekSignals = this.getSignals({ afterMs: weekStart.getTime() });
    const top = weekSignals
      .sort((a, b) => ({ strong: 0, moderate: 1, weak: 2 }[a.strength] || 2) - ({ strong: 0, moderate: 1, weak: 2 }[b.strength] || 2))
      .slice(0, 5)
      .map(s => s.description);

    const digest = {
      id:             _uid(),
      weekOf:         weekStart.toISOString(),
      totalSignals:   weekSignals.length,
      topSignals:     top,
      recommendation: top.length
        ? `This week's strongest market signals point to: ${top[0]}. Consider incorporating this into upcoming content and campaigns.`
        : 'No signals logged this week. Add observations from competitor content, industry articles, or customer conversations.'
    };

    const data = this._load();
    data.weeklyDigests.push(digest);
    this._save(data);
    return digest;
  }

  /**
   * Return a compact string for Claude system prompts summarising active signals.
   * @returns {string}
   */
  getSummaryForClaude() {
    const top = this.getTopSignals(5);
    if (!top.length) return 'No market signals tracked yet.';

    const lines = ['Current market signals (what\'s working right now):'];
    top.forEach((s, i) => {
      lines.push(`  ${i + 1}. [${s.type.toUpperCase()} / ${s.strength}] ${s.description}`);
      if (s.evidence) lines.push(`     Evidence: ${s.evidence}`);
    });
    return lines.join('\n');
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
   4. STRATEGIC BRIEFS
   Captures the "why" before any execution begins. Every piece of content or
   campaign should trace back to an approved strategic brief.
   ───────────────────────────────────────────────────────────────────────────── */

/**
 * StrategicBrief manages pre-execution rationale documents.
 *
 * Schema for each brief:
 * {
 *   id: string,
 *   createdAt: ISO string,
 *   approvedAt: ISO string | null,
 *   status: 'draft'|'approved'|'executed',
 *   initiative: string,
 *   why: string,
 *   competitiveContext: string,
 *   marketSignals: string[],
 *   differentiation: string,
 *   targetSegment: string,
 *   desiredOutcome: string,
 *   messagingAngle: string,
 *   channelFit: string[],
 *   risks: string[],
 *   agentTasking: {},
 *   executionIds: string[]
 * }
 */
class StrategicBrief {
  constructor() {
    /** @private */
    this._key = STORAGE_KEYS.STRATEGIC_BRIEFS;
  }

  /** @private */
  _load() {
    return _lsGet(this._key) || { briefs: [] };
  }

  /** @private */
  _save(data) {
    _lsSet(this._key, data);
    return data;
  }

  /**
   * Create and persist a new strategic brief.
   * @param {Object} briefData - partial brief; id and createdAt are auto-generated
   * @returns {Object} the saved brief
   */
  create(briefData) {
    if (!briefData || !briefData.initiative) {
      throw new TypeError('[StrategicBrief.create] briefData.initiative is required');
    }

    const brief = {
      id:                 _uid(),
      createdAt:          new Date().toISOString(),
      approvedAt:         null,
      status:             'draft',
      initiative:         briefData.initiative.trim(),
      why:                briefData.why || '',
      competitiveContext: briefData.competitiveContext || '',
      marketSignals:      Array.isArray(briefData.marketSignals) ? briefData.marketSignals : [],
      differentiation:    briefData.differentiation || '',
      targetSegment:      briefData.targetSegment || '',
      desiredOutcome:     briefData.desiredOutcome || '',
      messagingAngle:     briefData.messagingAngle || '',
      channelFit:         Array.isArray(briefData.channelFit) ? briefData.channelFit : [],
      risks:              Array.isArray(briefData.risks) ? briefData.risks : [],
      agentTasking:       briefData.agentTasking || {},
      executionIds:       []
    };

    const data = this._load();
    data.briefs.push(brief);
    this._save(data);
    return brief;
  }

  /**
   * Save (overwrite) a full brief object by ID.
   * @param {Object} brief - must have a valid id
   * @returns {Object|null} saved brief or null if not found
   */
  save(brief) {
    if (!brief || !brief.id) throw new TypeError('[StrategicBrief.save] brief.id is required');
    const data = this._load();
    const idx = data.briefs.findIndex(b => b.id === brief.id);
    if (idx === -1) {
      console.warn(`[StrategicBrief.save] brief ${brief.id} not found; use create() instead`);
      return null;
    }
    data.briefs[idx] = brief;
    this._save(data);
    return brief;
  }

  /**
   * Return all briefs, newest first.
   * @returns {Object[]}
   */
  getAll() {
    return [...this._load().briefs].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  /**
   * Return a single brief by ID.
   * @param {string} id
   * @returns {Object|null}
   */
  getById(id) {
    return this._load().briefs.find(b => b.id === id) || null;
  }

  /**
   * Mark a draft brief as approved.
   * @param {string} id
   * @returns {Object|null} updated brief or null
   */
  approve(id) {
    const data = this._load();
    const brief = data.briefs.find(b => b.id === id);
    if (!brief) {
      console.warn(`[StrategicBrief.approve] brief ${id} not found`);
      return null;
    }
    brief.status = 'approved';
    brief.approvedAt = new Date().toISOString();
    this._save(data);
    return brief;
  }

  /**
   * Link a brief to a specific execution output (e.g. a content item ID).
   * Marks the brief as 'executed'.
   * @param {string} id          - brief ID
   * @param {string} executionId - the downstream execution ID to link
   * @returns {Object|null}
   */
  linkToExecution(id, executionId) {
    const data = this._load();
    const brief = data.briefs.find(b => b.id === id);
    if (!brief) return null;
    if (!brief.executionIds) brief.executionIds = [];
    brief.executionIds.push(executionId);
    brief.status = 'executed';
    this._save(data);
    return brief;
  }

  /**
   * Return the Claude prompt used to generate a strategic brief.
   * @param {string} initiative - what we intend to create / do
   * @param {Object} context    - output of IntelligenceEngine.getContextBundle()
   * @returns {string} the full prompt string to pass to Claude
   */
  generateBriefPrompt(initiative, context) {
    const sections = [
      `You are a senior marketing strategist. Generate a strategic brief for the following initiative.`,
      ``,
      `INITIATIVE: ${initiative}`,
      ``,
      `BUSINESS CONTEXT:`,
      context.businessContext || 'Not yet configured.',
      ``,
      `COMPETITIVE LANDSCAPE:`,
      context.competitiveLandscape || 'Not yet configured.',
      ``,
      `MARKET SIGNALS:`,
      context.marketSignals || 'Not yet configured.',
      ``,
      `Return a JSON object with EXACTLY these keys:`,
      `{`,
      `  "why": "The strategic case for this initiative — why now, why us",`,
      `  "competitiveContext": "What competitors are doing and how this differs",`,
      `  "marketSignals": ["signal 1", "signal 2", "signal 3"],`,
      `  "differentiation": "How our approach is genuinely different",`,
      `  "targetSegment": "Exactly who this is for — be specific",`,
      `  "desiredOutcome": "The measurable goal (e.g. 50 email sign-ups, 3 sales calls)",`,
      `  "messagingAngle": "The 'why now' angle or hook for this initiative",`,
      `  "channelFit": ["channel1", "channel2"],`,
      `  "risks": ["risk1", "risk2"],`,
      `  "agentTasking": {`,
      `    "contentAgent": "brief for content agent if needed",`,
      `    "emailAgent": "brief for email agent if needed",`,
      `    "socialAgent": "brief for social agent if needed",`,
      `    "seoAgent": "brief for SEO agent if needed",`,
      `    "adsAgent": "brief for ads agent if needed"`,
      `  }`,
      `}`,
      ``,
      `Output ONLY valid JSON. No markdown, no explanation, no code fences.`
    ];

    return sections.join('\n');
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
   5. INTELLIGENCE ENGINE (main export)
   The orchestration layer — used by Scotty and all execution agents.
   ───────────────────────────────────────────────────────────────────────────── */

/**
 * IntelligenceEngine is the top-level facade for all four intelligence stores.
 * Every agent should call getContextBundle() before composing its system prompt.
 */
class IntelligenceEngine {
  constructor() {
    /** @type {BusinessBrain} */
    this.brain = new BusinessBrain();
    /** @type {CompetitiveRadar} */
    this.radar = new CompetitiveRadar();
    /** @type {MarketPulse} */
    this.pulse = new MarketPulse();
    /** @type {StrategicBrief} */
    this.briefs = new StrategicBrief();
  }

  /**
   * The most important method.
   * Returns a bundle of everything a downstream agent needs before executing.
   *
   * @returns {{
   *   businessContext: string,
   *   competitiveLandscape: string,
   *   marketSignals: string,
   *   isReady: boolean,
   *   completionScore: number
   * }}
   */
  getContextBundle() {
    return {
      businessContext:     this.brain.getContextSummary(),
      competitiveLandscape: this.radar.getSummaryForClaude(),
      marketSignals:       this.pulse.getSummaryForClaude(),
      isReady:             this.brain.isConfigured(),
      completionScore:     this.brain.getCompletionScore()
    };
  }

  /**
   * Build the full system prompt prefix that agents prepend to their own prompts.
   * Call this in every agent's system prompt construction.
   * @returns {string}
   */
  buildSystemPromptPrefix() {
    const bundle = this.getContextBundle();
    if (!bundle.isReady) {
      return '(No business intelligence configured yet. Operate with general marketing best practices.)';
    }

    return [
      '=== STRATEGIC INTELLIGENCE CONTEXT ===',
      '',
      bundle.businessContext,
      '',
      '--- Competitive Landscape ---',
      bundle.competitiveLandscape,
      '',
      '--- Live Market Signals ---',
      bundle.marketSignals,
      '',
      '=== END INTELLIGENCE CONTEXT ===',
      ''
    ].join('\n');
  }

  /* ───────────────────────────────────────────────────────────────────────────
     STRUCTURED DATA EXTRACTION METHODS
     These return programmatic data structures for agents to use directly,
     instead of raw text summaries that get truncated or dumped as JSON.
     ─────────────────────────────────────────────────────────────────────────── */

  /**
   * Extract ICP pain points as a clean array of strings.
   * @returns {string[]} - array of pain points (empty if none configured)
   */
  extractICPPainPoints() {
    const brain = this.brain.load();
    return (brain.icp?.painPoints || []).filter(p => p && p.trim());
  }

  /**
   * Extract firmographic targeting criteria for ads, sales, and analytics.
   * @returns {{role: string, companySize: string, industry: string, language: string[]}}
   */
  extractFirmographicTargets() {
    const brain = this.brain.load();
    const buyer = brain.icp?.primaryBuyer || {};
    return {
      role:        buyer.role || '',
      companySize: buyer.companySize || '',
      industry:    buyer.industry || '',
      language:    Array.isArray(brain.icp?.language) ? brain.icp.language :
                   (brain.icp?.language ? String(brain.icp.language).split('\n').map(s => s.trim()).filter(Boolean) : [])
    };
  }

  /**
   * Extract value propositions as an array of benefit statements.
   * @returns {string[]} - array of value props
   */
  extractValueProps() {
    const brain = this.brain.load();
    const props = [];

    if (brain.positioning?.uniqueValue) {
      props.push(brain.positioning.uniqueValue);
    }

    const diffs = (brain.positioning?.differentiation || []).filter(d => d && d.trim());
    props.push(...diffs);

    return props;
  }

  /**
   * Extract competitive differentiation points (how we're different).
   * @returns {string[]} - array of competitive edges
   */
  extractCompetitiveEdges() {
    const brain = this.brain.load();
    const edges = [];

    const diffs = (brain.positioning?.differentiation || []).filter(d => d && d.trim());
    edges.push(...diffs);

    if (brain.positioning?.notLikeCompetitors) {
      edges.push(brain.positioning.notLikeCompetitors);
    }

    return edges;
  }

  /**
   * Extract buyer journey messaging for each stage.
   * @returns {{awareness: string, consideration: string, decision: string}}
   */
  extractBuyerJourneyMessaging() {
    const brain = this.brain.load();
    return {
      awareness:     brain.icp?.buyerJourney?.aware || '',
      consideration: brain.icp?.buyerJourney?.consider || '',
      decision:      brain.icp?.buyerJourney?.decide || ''
    };
  }

  /**
   * Extract brand voice and tone guidelines.
   * @returns {{tone: string[], avoid: string, notLikeCompetitors: string}}
   */
  extractBrandVoice() {
    const brain = this.brain.load();
    return {
      tone:                brain.positioning?.voiceAndTone || [],
      avoid:               brain.positioning?.thingsWeNeverSay || '',
      notLikeCompetitors:  brain.positioning?.notLikeCompetitors || ''
    };
  }

  /**
   * Extract ICP context (what they tried before, why they chose us, biggest fear).
   * @returns {{triedBefore: string, reasonChose: string, biggestFear: string}}
   */
  extractICPContext() {
    const brain = this.brain.load();
    return {
      triedBefore:  brain.icp?.triedBefore || '',
      reasonChose:  brain.icp?.reasonChose || '',
      biggestFear:  brain.icp?.biggestFear || ''
    };
  }

  /**
   * Extract company basics (name, tagline, industry, stage).
   * @returns {{name: string, tagline: string, industry: string, stage: string, description: string}}
   */
  extractCompanyBasics() {
    const brain = this.brain.load();
    return {
      name:        brain.company?.name || '',
      tagline:     brain.company?.tagline || '',
      industry:    brain.company?.industry || '',
      stage:       brain.company?.stage || '',
      description: brain.company?.description || ''
    };
  }

  /**
   * Extract current objectives (Q1 focus, annual goal, current challenge).
   * @returns {{q1Focus: string, annualGoal: string, currentChallenge: string, bestLeadChannels: string[]}}
   */
  extractObjectives() {
    const brain = this.brain.load();
    return {
      q1Focus:           brain.objectives?.q1Focus || '',
      annualGoal:        brain.objectives?.annualGoal || '',
      currentChallenge:  brain.objectives?.currentChallenge || '',
      bestLeadChannels:  brain.objectives?.bestLeadChannels || []
    };
  }

  /**
   * Extract high-priority competitive gaps we can exploit.
   * @returns {Array<{competitor: string, gap: string, opportunity: string}>}
   */
  extractCompetitiveGaps() {
    const gaps = this.radar.getTopGaps();
    return gaps
      .filter(g => g.gap.priority === 'high')
      .map(g => ({
        competitor:  g.competitor,
        gap:         g.gap.gap,
        opportunity: g.gap.opportunity
      }));
  }

  /**
   * Extract top market signals (what's working right now).
   * @param {number} [n=5] - number of signals to return
   * @returns {Array<{type: string, description: string, strength: string, evidence: string}>}
   */
  extractMarketSignals(n = 5) {
    const signals = this.pulse.getTopSignals(n);
    return signals.map(s => ({
      type:        s.type,
      description: s.description,
      strength:    s.strength,
      evidence:    s.evidence
    }));
  }

  /**
   * Build a complete context object for agent use.
   * This is the NEW way agents should consume Intelligence Layer data.
   *
   * @returns {{
   *   company: {name: string, tagline: string, industry: string, stage: string, description: string},
   *   icp: {
   *     painPoints: string[],
   *     firmographics: {role: string, companySize: string, industry: string, language: string[]},
   *     context: {triedBefore: string, reasonChose: string, biggestFear: string},
   *     buyerJourney: {awareness: string, consideration: string, decision: string}
   *   },
   *   positioning: {
   *     valueProps: string[],
   *     competitiveEdges: string[],
   *     brandVoice: {tone: string[], avoid: string, notLikeCompetitors: string}
   *   },
   *   competitive: {
   *     gaps: Array<{competitor: string, gap: string, opportunity: string}>
   *   },
   *   market: {
   *     signals: Array<{type: string, description: string, strength: string, evidence: string}>
   *   },
   *   objectives: {q1Focus: string, annualGoal: string, currentChallenge: string, bestLeadChannels: string[]},
   *   meta: {isReady: boolean, completionScore: number}
   * }}
   */
  extractStructuredContext() {
    return {
      company:     this.extractCompanyBasics(),
      icp: {
        painPoints:     this.extractICPPainPoints(),
        firmographics:  this.extractFirmographicTargets(),
        context:        this.extractICPContext(),
        buyerJourney:   this.extractBuyerJourneyMessaging()
      },
      positioning: {
        valueProps:       this.extractValueProps(),
        competitiveEdges: this.extractCompetitiveEdges(),
        brandVoice:       this.extractBrandVoice()
      },
      competitive: {
        gaps: this.extractCompetitiveGaps()
      },
      market: {
        signals: this.extractMarketSignals(5)
      },
      objectives:  this.extractObjectives(),
      meta: {
        isReady:         this.brain.isConfigured(),
        completionScore: this.brain.getCompletionScore()
      }
    };
  }

  /**
   * Generate a strategic brief for an initiative by calling Claude.
   * The brief is stored in the StrategicBrief store and returned.
   *
   * @param {string} initiative     - what we're making / doing
   * @param {Object} claudeService  - the ClaudeService instance (must have callAgent())
   * @returns {Promise<Object>}     - the created brief object
   */
  async generateStrategicBrief(initiative, claudeService) {
    if (!initiative || !initiative.trim()) {
      throw new TypeError('[IntelligenceEngine.generateStrategicBrief] initiative is required');
    }
    if (!claudeService || typeof claudeService.callAgent !== 'function') {
      throw new TypeError('[IntelligenceEngine.generateStrategicBrief] claudeService with callAgent() is required');
    }

    const context = this.getContextBundle();
    const prompt  = this.briefs.generateBriefPrompt(initiative, context);

    let rawResponse;
    try {
      rawResponse = await claudeService.callAgent({
        systemPrompt: 'You are a senior marketing strategist. Output only valid JSON.',
        messages: [{ role: 'user', content: prompt }]
      });
    } catch (err) {
      throw new Error(`[IntelligenceEngine] Claude call failed: ${err.message}`);
    }

    let briefData;
    try {
      // Strip code fences if Claude wraps the JSON anyway
      const cleaned = rawResponse.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '').trim();
      briefData = JSON.parse(cleaned);
    } catch (parseErr) {
      throw new Error(`[IntelligenceEngine] Failed to parse Claude brief JSON: ${parseErr.message}\nRaw: ${rawResponse}`);
    }

    return this.briefs.create({ initiative, ...briefData });
  }

  /**
   * Returns true if BusinessBrain has enough data to be useful.
   * Delegates to BusinessBrain.isConfigured() so callers on the facade work correctly.
   * @returns {boolean}
   */
  isConfigured() {
    return this.brain.isConfigured();
  }

  /**
   * Returns true if the given context store has data.
   * @param {'business'|'competitive'|'market'} type
   * @returns {boolean}
   */
  hasContext(type) {
    if (type === 'business')     return this.brain.isConfigured();
    if (type === 'competitive')  return this.radar.hasData();
    if (type === 'market')       return this.pulse.hasData();
    return false;
  }

  /**
   * Check whether the intelligence layer has enough context for high-quality outputs.
   *
   * @returns {{
   *   ready: boolean,
   *   score: number,
   *   missing: string[]
   * }}
   */
  validateReadiness() {
    const brain = this.brain.load();
    const score = this.brain.getCompletionScore();
    const missing = [];

    if (!brain.company.name)            missing.push('Company name');
    if (!brain.company.description)     missing.push('Company description');
    if (!brain.icp.primaryBuyer.role)   missing.push('Primary buyer role (ICP)');

    const pains = (brain.icp.painPoints || []).filter(p => p && p.trim());
    if (!pains.length) missing.push('At least one ICP pain point');

    if (!brain.positioning.uniqueValue) missing.push('Unique value proposition');

    const diffs = (brain.positioning.differentiation || []).filter(d => d && d.trim());
    if (!diffs.length) missing.push('At least one differentiator');

    if (!brain.objectives.q1Focus)      missing.push('Q1 / current focus');

    return {
      ready:   missing.length === 0,
      score,
      missing
    };
  }

  /**
   * Wipe all four intelligence stores. Use with caution.
   * @param {boolean} [confirm=false] - must pass true to actually clear
   */
  clearAll(confirm = false) {
    if (!confirm) {
      console.warn('[IntelligenceEngine.clearAll] Pass true to confirm clearing all intelligence data.');
      return;
    }
    Object.values(STORAGE_KEYS).forEach(key => localStorage.removeItem(key));
    // Business Brain is stored per-project (STORAGE_KEYS.BUSINESS_BRAIN + '__' + projectId) —
    // remove every project-scoped bucket too, not just the legacy global key.
    Object.keys(localStorage)
      .filter(k => k.startsWith(`${STORAGE_KEYS.BUSINESS_BRAIN}__`))
      .forEach(k => localStorage.removeItem(k));
    console.info('[IntelligenceEngine] All intelligence stores cleared.');
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
   EXPORT — singleton on window, available to all pages and agents
   ───────────────────────────────────────────────────────────────────────────── */
window.IntelligenceEngine = new IntelligenceEngine();

// Also expose the classes for advanced usage / testing
window.IntelligenceEngineClasses = { BusinessBrain, CompetitiveRadar, MarketPulse, StrategicBrief };
