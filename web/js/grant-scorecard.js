/**
 * GrantScorecard — Audema's Grant Readiness Scorecard.
 *
 * The point of this model is to stop the funding function turning into an
 * application factory. Pointless applications are expensive in the one
 * resource a small company cannot buy more of — senior management attention —
 * so every opportunity gets scored before anyone writes a word, and the score
 * carries a decision, not a vibe.
 *
 * Nine criteria, weights totalling 100. Each is scored 0-10, and the
 * contribution is score × (weight / 10), so a perfect card is exactly 100.
 *
 * ── The inversion that matters ──────────────────────────────────────────
 * Three criteria are COSTS, not benefits: application workload, matching
 * contribution required, and reporting burden. Scored naively ("more = higher
 * number") a brutal, cash-matched, heavily-audited grant would score *well* —
 * exactly backwards. So every criterion here is scored on one consistent
 * axis: 10 always means "best for Audema". For the three cost criteria that
 * means 10 = minimal burden. The rubric text on each option says so
 * explicitly, because an ambiguous rubric produces confident wrong answers.
 */
window.GrantScorecard = (function () {
  'use strict';

  /**
   * @typedef {{key: string, label: string, weight: number, kind: 'benefit'|'cost',
   *            help: string, rubric: {[score: number]: string}}} Criterion
   */
  const CRITERIA = [
    {
      key: 'eligibility',
      label: 'Eligibility certainty',
      weight: 20,
      kind: 'benefit',
      help: 'Do we clearly meet the stated eligibility criteria — entity type, turnover, sector, location, stage?',
      rubric: {
        10: 'We plainly meet every published criterion',
        7:  'We meet the criteria on a reasonable reading',
        5:  'Ambiguous — needs a conversation with the program officer',
        2:  'We probably fall outside at least one criterion',
        0:  'We are clearly ineligible',
      },
    },
    {
      key: 'alignment',
      label: 'Alignment with government objectives',
      weight: 20,
      kind: 'benefit',
      help: "How closely does what we'd do with the money match what this program was created to achieve?",
      rubric: {
        10: 'Audema is close to a textbook example of the program intent',
        7:  'Strong alignment with the stated objectives',
        5:  'Partial — we fit one objective but not the emphasis',
        2:  'We would be arguing the program into a shape it is not',
        0:  'No meaningful alignment',
      },
    },
    {
      key: 'advantage',
      label: 'Audema competitive advantage',
      weight: 15,
      kind: 'benefit',
      help: 'Against the likely applicant pool, do we have something genuinely distinctive to point at?',
      rubric: {
        10: 'Distinctive Australian IP and a track record few applicants can match',
        7:  'Clear differentiation we can evidence',
        5:  'Comparable to a typical applicant',
        2:  'Weaker than most likely applicants',
        0:  'Nothing distinctive to argue',
      },
    },
    {
      key: 'amount',
      label: 'Funding amount',
      weight: 10,
      kind: 'benefit',
      help: 'Is the money material relative to the effort of applying and administering it?',
      rubric: {
        10: 'Transformational for the current stage',
        7:  'Materially useful',
        5:  'Worth having',
        2:  'Small relative to the work involved',
        0:  'Trivial',
      },
    },
    {
      key: 'probability',
      label: 'Probability of success',
      weight: 10,
      kind: 'benefit',
      help: 'Realistically, given the pool, success rate and our readiness — not optimism.',
      rubric: {
        10: 'Strong odds; few credible competitors',
        7:  'Better than even',
        5:  'Genuine coin-toss',
        2:  'Long shot',
        0:  'Near-hopeless',
      },
    },
    {
      key: 'strategic',
      label: 'Strategic value beyond money',
      weight: 10,
      kind: 'benefit',
      help: 'Relationships, credentials, procurement doors, partners, references — what it unlocks besides cash.',
      rubric: {
        10: 'Opens a government relationship or channel worth more than the grant',
        7:  'Meaningful credential or partnership value',
        5:  'Some reputational value',
        2:  'Little beyond the money',
        0:  'None',
      },
    },
    {
      key: 'workload',
      label: 'Application workload',
      weight: 5,
      kind: 'cost',
      help: 'How much senior time the application itself consumes. Higher score = LESS work.',
      rubric: {
        10: 'Light — days, largely from existing material',
        7:  'Moderate',
        5:  'Heavy but manageable',
        2:  'Very heavy — weeks of senior time',
        0:  'Enormous — would displace real work',
      },
    },
    {
      key: 'matching',
      label: 'Matching contribution required',
      weight: 5,
      kind: 'cost',
      help: 'Cash or in-kind we must put up. Higher score = LESS matching required.',
      rubric: {
        10: 'None required',
        7:  'Small, and in-kind is accepted',
        5:  'Meaningful but affordable',
        2:  'Large cash match',
        0:  'Beyond what we can commit',
      },
    },
    {
      key: 'reporting',
      label: 'Reporting burden',
      weight: 5,
      kind: 'cost',
      help: 'Ongoing acquittal, milestone and audit obligations. Higher score = LIGHTER burden.',
      rubric: {
        10: 'Minimal — a short final report',
        7:  'Light periodic reporting',
        5:  'Standard milestone reporting',
        2:  'Heavy — frequent audited acquittals',
        0:  'Onerous enough to need dedicated admin',
      },
    },
  ];

  const MAX_CRITERION_SCORE = 10;

  /**
   * Decision bands. Ordered high to low; first match wins.
   * Straight from the policy: an application factory is what happens when
   * every opportunity is treated as worth a go.
   */
  const BANDS = [
    { min: 80, key: 'apply',   label: 'APPLY IMMEDIATELY',      tone: 'go',
      guidance: 'Strong fit. Move to application and assign an owner now.' },
    { min: 65, key: 'strategic', label: 'STRATEGIC APPLICATION', tone: 'go',
      guidance: 'Worth applying, but treat it as a considered strategic play rather than a rush.' },
    { min: 50, key: 'partner', label: 'ONLY WITH STRONG PARTNER', tone: 'conditional',
      guidance: 'Do not apply alone. Proceed only with a research, council or industry partner who materially lifts the case.' },
    { min: 0,  key: 'decline', label: "DON'T APPLY",             tone: 'no-go',
      guidance: 'Below threshold. Record why and move on — the management time is better spent elsewhere.' },
  ];

  /** Weights must total 100 or every score printed is quietly wrong. */
  const TOTAL_WEIGHT = CRITERIA.reduce((sum, c) => sum + c.weight, 0);
  if (TOTAL_WEIGHT !== 100) {
    console.error(`[GrantScorecard] weights total ${TOTAL_WEIGHT}, expected 100 — scores will not be out of 100.`);
  }

  function getCriteria() {
    // Copy so a caller mutating a rubric can't corrupt the model for everyone.
    return CRITERIA.map(c => Object.assign({}, c, { rubric: Object.assign({}, c.rubric) }));
  }

  function clampScore(v) {
    const n = Number(v);
    if (!isFinite(n)) return 0;
    return Math.max(0, Math.min(MAX_CRITERION_SCORE, n));
  }

  /**
   * @param {{[criterionKey: string]: number}} scores  0-10 per criterion
   * @returns {{total: number, complete: boolean, missing: string[],
   *            band: object, contributions: Array}}
   */
  function score(scores) {
    scores = scores || {};
    const missing = [];
    let total = 0;
    const contributions = [];

    CRITERIA.forEach(c => {
      const raw = scores[c.key];
      const scored = raw !== undefined && raw !== null && raw !== '';
      if (!scored) missing.push(c.key);
      const value = clampScore(scored ? raw : 0);
      const contribution = value * (c.weight / MAX_CRITERION_SCORE);
      total += contribution;
      contributions.push({
        key: c.key, label: c.label, weight: c.weight, kind: c.kind,
        value, contribution: Math.round(contribution * 10) / 10, scored,
      });
    });

    const rounded = Math.round(total);
    return {
      total: rounded,
      complete: missing.length === 0,
      missing,
      band: bandFor(rounded),
      contributions,
    };
  }

  /** @param {number} total 0-100 */
  function bandFor(total) {
    const n = Math.max(0, Math.min(100, Number(total) || 0));
    return BANDS.find(b => n >= b.min) || BANDS[BANDS.length - 1];
  }

  /**
   * A partial scorecard is not a decision. An unscored criterion counts as
   * zero for arithmetic, which drags the total down — so an incomplete card
   * can look like a "DON'T APPLY" when nobody has actually judged it. Callers
   * should use this before showing a verdict as if it were settled.
   */
  function isDecisionReady(scores) {
    return score(scores).complete;
  }

  return {
    CRITERIA: getCriteria,
    BANDS: () => BANDS.map(b => Object.assign({}, b)),
    TOTAL_WEIGHT,
    MAX_CRITERION_SCORE,
    score,
    bandFor,
    isDecisionReady,
  };
})();
