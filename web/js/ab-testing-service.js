/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * A/B TESTING SERVICE — Audema Lead Generation
 *
 * Tracks outreach message variants and their outcomes across the prospect CRM.
 * Zero external dependencies — all data stored in localStorage.
 *
 * Core concepts:
 *   Test     — a named experiment with 2 variants (A and B)
 *   Send     — one prospect received one variant
 *   Outcome  — what happened: responded | meeting | no_response | lost
 *
 * Usage:
 *   ABTestingService.createTest({ name, variantA, variantB, agentType })
 *   ABTestingService.recordSend(testId, variant, prospectId)
 *   ABTestingService.recordOutcome(testId, prospectId, outcome)
 *   ABTestingService.getResults(testId) → stats per variant
 *   ABTestingService.getActiveTests()
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const ABTestingService = (() => {
  'use strict';

  const STORAGE_TESTS   = 'ab_tests';
  const STORAGE_SENDS   = 'ab_sends';

  const VALID_OUTCOMES  = ['responded', 'meeting', 'no_response', 'lost'];
  const VALID_VARIANTS  = ['A', 'B'];

  /* ── Persistence ─────────────────────────────────────────────────────────── */

  function loadTests()  { try { return JSON.parse(localStorage.getItem(STORAGE_TESTS) || '[]'); } catch(_) { return []; } }
  function saveTests(t) { try { localStorage.setItem(STORAGE_TESTS, JSON.stringify(t)); } catch(_) {} }
  function loadSends()  { try { return JSON.parse(localStorage.getItem(STORAGE_SENDS) || '[]'); } catch(_) { return []; } }
  function saveSends(s) { try { localStorage.setItem(STORAGE_SENDS, JSON.stringify(s)); } catch(_) {} }

  function uid() {
    return `ab_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  }

  /* ── Test CRUD ───────────────────────────────────────────────────────────── */

  /**
   * Create a new A/B test.
   * @param {Object} opts
   * @param {string}  opts.name       — human label, e.g. "Q2 Subject Line Test"
   * @param {string}  opts.variantA   — full text of variant A (subject or opening line)
   * @param {string}  opts.variantB   — full text of variant B
   * @param {string}  [opts.agentType] — 'subject_line' | 'opening_line' | 'cta' | 'full_message'
   * @param {string}  [opts.scottyBriefId] — links back to the Scotty brief that generated variants
   * @returns {Object} the new test
   */
  function createTest({ name, variantA, variantB, agentType = 'subject_line', scottyBriefId = null } = {}) {
    if (!name || !variantA || !variantB) throw new Error('name, variantA, and variantB are required');
    const test = {
      id:            uid(),
      name,
      variantA,
      variantB,
      agentType,
      scottyBriefId,
      status:        'active',   // 'active' | 'paused' | 'concluded'
      winner:        null,       // 'A' | 'B' | 'inconclusive'
      createdAt:     new Date().toISOString(),
      concludedAt:   null,
    };
    const tests = loadTests();
    tests.unshift(test);
    saveTests(tests);
    return test;
  }

  function getAll()          { return loadTests(); }
  function getActiveTests()  { return loadTests().filter(t => t.status === 'active'); }
  function getById(id)       { return loadTests().find(t => t.id === id) || null; }

  function updateTest(id, patch) {
    const tests = loadTests();
    const idx   = tests.findIndex(t => t.id === id);
    if (idx === -1) throw new Error(`Test ${id} not found`);
    tests[idx] = { ...tests[idx], ...patch };
    saveTests(tests);
    return tests[idx];
  }

  function deleteTest(id) {
    saveTests(loadTests().filter(t => t.id !== id));
    saveSends(loadSends().filter(s => s.testId !== id));
  }

  function concludeTest(id, winner) {
    return updateTest(id, { status: 'concluded', winner, concludedAt: new Date().toISOString() });
  }

  /* ── Send recording ──────────────────────────────────────────────────────── */

  /**
   * Record that a prospect was sent a specific variant.
   * @param {string} testId
   * @param {string} variant  — 'A' or 'B'
   * @param {string} prospectId
   * @returns {Object} the send record
   */
  function recordSend(testId, variant, prospectId) {
    if (!VALID_VARIANTS.includes(variant)) throw new Error(`variant must be 'A' or 'B'`);
    const sends = loadSends();
    // Overwrite if this prospect already has a send for this test
    const existing = sends.findIndex(s => s.testId === testId && s.prospectId === prospectId);
    const record = { id: uid(), testId, variant, prospectId, sentAt: new Date().toISOString(), outcome: null, outcomeAt: null };
    if (existing !== -1) sends[existing] = record;
    else sends.push(record);
    saveSends(sends);
    return record;
  }

  /**
   * Record the outcome for a prospect in a test.
   * @param {string} testId
   * @param {string} prospectId
   * @param {string} outcome — 'responded' | 'meeting' | 'no_response' | 'lost'
   */
  function recordOutcome(testId, prospectId, outcome) {
    if (!VALID_OUTCOMES.includes(outcome)) throw new Error(`Invalid outcome: ${outcome}`);
    const sends = loadSends();
    const idx   = sends.findIndex(s => s.testId === testId && s.prospectId === prospectId);
    if (idx === -1) throw new Error(`No send record found for test ${testId}, prospect ${prospectId}`);
    sends[idx].outcome   = outcome;
    sends[idx].outcomeAt = new Date().toISOString();
    saveSends(sends);
    return sends[idx];
  }

  /* ── Results ─────────────────────────────────────────────────────────────── */

  /**
   * Calculate results for a test.
   * @param {string} testId
   * @returns {{
   *   test: Object,
   *   A: { sent, responded, meeting, response_rate, meeting_rate },
   *   B: { sent, responded, meeting, response_rate, meeting_rate },
   *   winner: 'A' | 'B' | 'tied' | 'insufficient_data',
   *   confidence: 'high' | 'medium' | 'low'
   * }}
   */
  function getResults(testId) {
    const test  = getById(testId);
    if (!test) throw new Error(`Test ${testId} not found`);
    const sends = loadSends().filter(s => s.testId === testId);

    const stats = { A: { sent: 0, responded: 0, meeting: 0 }, B: { sent: 0, responded: 0, meeting: 0 } };
    for (const s of sends) {
      if (!stats[s.variant]) continue;
      stats[s.variant].sent++;
      if (s.outcome === 'responded' || s.outcome === 'meeting') stats[s.variant].responded++;
      if (s.outcome === 'meeting') stats[s.variant].meeting++;
    }

    const rate = (n, d) => d === 0 ? 0 : Math.round((n / d) * 100);

    const A = { ...stats.A, response_rate: rate(stats.A.responded, stats.A.sent), meeting_rate: rate(stats.A.meeting, stats.A.sent) };
    const B = { ...stats.B, response_rate: rate(stats.B.responded, stats.B.sent), meeting_rate: rate(stats.B.meeting, stats.B.sent) };

    const minSamples   = 10;
    const totalSent    = A.sent + B.sent;
    const confidence   = totalSent >= minSamples * 2 ? 'high' : totalSent >= minSamples ? 'medium' : 'low';

    let winner = 'insufficient_data';
    if (A.sent >= 5 && B.sent >= 5) {
      if (A.response_rate > B.response_rate + 5)      winner = 'A';
      else if (B.response_rate > A.response_rate + 5) winner = 'B';
      else                                              winner = 'tied';
    }

    return { test, A, B, winner, confidence };
  }

  /**
   * Get results for all tests.
   */
  function getAllResults() {
    return loadTests().map(t => {
      try { return getResults(t.id); }
      catch(_) { return { test: t, A: null, B: null, winner: 'error', confidence: 'low' }; }
    });
  }

  /**
   * Get the send record for a specific prospect across all active tests.
   * Used by the prospect card to show which variant was sent.
   * @param {string} prospectId
   * @returns {Array<{testId, variant, outcome, testName}>}
   */
  function getProspectAssignments(prospectId) {
    const sends = loadSends().filter(s => s.prospectId === prospectId);
    const tests = loadTests();
    return sends.map(s => {
      const test = tests.find(t => t.id === s.testId);
      return { ...s, testName: test?.name || 'Unknown test' };
    });
  }

  /**
   * Import A/B variants generated by Scotty's lead gen brief.
   * Parses "Subject A:" / "Subject B:" / "Opening A:" / "Opening B:" from brief text.
   * @param {string} briefText — Scotty lead gen brief markdown
   * @param {string} [briefId]
   * @returns {Array<Object>} created tests
   */
  function importFromScottyBrief(briefText, briefId = null) {
    if (!briefText) return [];
    const created = [];

    // Match patterns: "Subject A: ...\nSubject B: ..."
    const subjectA = briefText.match(/Subject A:\s*(.+)/i)?.[1]?.trim();
    const subjectB = briefText.match(/Subject B:\s*(.+)/i)?.[1]?.trim();
    if (subjectA && subjectB) {
      try {
        created.push(createTest({
          name:          `Scotty Subject Line Test — ${new Date().toLocaleDateString()}`,
          variantA:      subjectA,
          variantB:      subjectB,
          agentType:     'subject_line',
          scottyBriefId: briefId,
        }));
      } catch (_) {}
    }

    // Match patterns: "Opening A: ...\nOpening B: ..."
    const openingA = briefText.match(/Opening A:\s*(.+)/i)?.[1]?.trim();
    const openingB = briefText.match(/Opening B:\s*(.+)/i)?.[1]?.trim();
    if (openingA && openingB) {
      try {
        created.push(createTest({
          name:          `Scotty Opening Line Test — ${new Date().toLocaleDateString()}`,
          variantA:      openingA,
          variantB:      openingB,
          agentType:     'opening_line',
          scottyBriefId: briefId,
        }));
      } catch (_) {}
    }

    return created;
  }

  /* ── Public API ─────────────────────────────────────────────────────────── */
  return {
    createTest, getAll, getActiveTests, getById, updateTest, deleteTest, concludeTest,
    recordSend, recordOutcome,
    getResults, getAllResults, getProspectAssignments,
    importFromScottyBrief,
    VALID_OUTCOMES, VALID_VARIANTS,
  };
})();

window.ABTestingService = ABTestingService;
