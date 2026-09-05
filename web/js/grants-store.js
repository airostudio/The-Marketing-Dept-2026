/**
 * GrantsStore — Audema's own government funding pipeline.
 *
 * Backed by Supabase (supabase-grants.sql, admin-only RLS) with a
 * localStorage fallback so the Funding Room is usable the moment it loads,
 * before anyone has run the migration. The fallback is explicitly reported
 * through isCloud() rather than hidden: someone entering a real funding
 * pipeline deserves to know whether it is saved to the account or only to
 * this browser.
 */
window.GrantsStore = (function () {
  'use strict';

  const LOCAL_KEY = 'audema_grant_opportunities';
  const TABLE = 'grant_opportunities';

  let cloudAvailable = null; // null = not yet determined

  const STAGES = [
    { key: 'discovered',        label: 'Discovered',        group: 'assess' },
    { key: 'eligibility_check', label: 'Eligibility check', group: 'assess' },
    { key: 'strategic_fit',     label: 'Strategic fit',     group: 'assess' },
    { key: 'partners_required', label: 'Partners required', group: 'assess' },
    { key: 'go_no_go',          label: 'Go / No-go',        group: 'decide' },
    { key: 'application',       label: 'Application',       group: 'pursue' },
    { key: 'assessment',        label: 'Assessment',        group: 'pursue' },
    { key: 'funded',            label: 'Funded',            group: 'won' },
    { key: 'milestones',        label: 'Milestones',        group: 'won' },
    { key: 'acquittal',         label: 'Acquittal',         group: 'won' },
    { key: 'next_round',        label: 'Next round',        group: 'won' },
    { key: 'not_proceeding',    label: 'Not proceeding',    group: 'closed' },
  ];

  const LEVELS = [
    { key: 'federal',              label: 'Federal' },
    { key: 'state_vic',            label: 'Victorian' },
    { key: 'local',                label: 'Local government' },
    { key: 'rd_tax_incentive',     label: 'R&D Tax Incentive' },
    { key: 'emdg',                 label: 'EMDG' },
    { key: 'commercialisation',    label: 'Commercialisation' },
    { key: 'research_partnership', label: 'Research partnership' },
    { key: 'university',           label: 'University collaboration' },
    { key: 'tender',               label: 'Government tender' },
    { key: 'international',        label: 'International funding' },
    { key: 'other',                label: 'Other' },
  ];

  /** Stages where the money is actually secured. */
  const WON_STAGES = ['funded', 'milestones', 'acquittal', 'next_round'];
  /** Stages still live in the pipeline (neither won nor dead). */
  const LIVE_STAGES = ['discovered', 'eligibility_check', 'strategic_fit',
                       'partners_required', 'go_no_go', 'application', 'assessment'];

  async function client() {
    if (window.Supabase?.ready) { try { await window.Supabase.ready(); } catch { /* fall through */ } }
    return window.Supabase?.getClient?.() || null;
  }

  function readLocal() {
    try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]'); } catch { return []; }
  }
  function writeLocal(list) {
    try { localStorage.setItem(LOCAL_KEY, JSON.stringify(list)); } catch { /* quota/blocked */ }
    return list;
  }
  function uid() {
    return 'grant_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  /** Whether the last operation used the cloud. null until something has run. */
  function isCloud() { return cloudAvailable; }

  async function list() {
    const c = await client();
    if (c) {
      const { data, error } = await c.from(TABLE).select('*').order('closes_at', { ascending: true, nullsFirst: false });
      if (!error) { cloudAvailable = true; return data || []; }
      // A missing table (migration not run) or an RLS refusal both land here.
      console.warn('[GrantsStore] cloud read failed, using local store:', error.message);
    }
    cloudAvailable = false;
    return readLocal();
  }

  async function create(record) {
    const row = Object.assign({
      name: 'Untitled opportunity',
      level: 'federal',
      stage: 'discovered',
      scorecard: {},
      currency: 'AUD',
    }, record);

    const c = await client();
    if (c) {
      const { data, error } = await c.from(TABLE).insert(row).select().single();
      if (!error) { cloudAvailable = true; return data; }
      console.warn('[GrantsStore] cloud insert failed, using local store:', error.message);
    }
    cloudAvailable = false;
    const local = readLocal();
    const withId = Object.assign({ id: uid(), created_at: new Date().toISOString() }, row);
    local.push(withId);
    writeLocal(local);
    return withId;
  }

  async function update(id, patch) {
    const c = await client();
    if (c) {
      const { data, error } = await c.from(TABLE).update(patch).eq('id', id).select().single();
      if (!error) { cloudAvailable = true; return data; }
      console.warn('[GrantsStore] cloud update failed, using local store:', error.message);
    }
    cloudAvailable = false;
    const local = readLocal();
    const row = local.find(r => r.id === id);
    if (row) Object.assign(row, patch, { updated_at: new Date().toISOString() });
    writeLocal(local);
    return row || null;
  }

  async function remove(id) {
    const c = await client();
    if (c) {
      const { error } = await c.from(TABLE).delete().eq('id', id);
      if (!error) { cloudAvailable = true; return true; }
      console.warn('[GrantsStore] cloud delete failed, using local store:', error.message);
    }
    cloudAvailable = false;
    writeLocal(readLocal().filter(r => r.id !== id));
    return true;
  }

  /**
   * Roll the pipeline up against the 36-month non-dilutive funding targets.
   *
   * `secured` counts only what has actually been awarded. `weighted` is the
   * live pipeline discounted by each opportunity's own probability-of-success
   * score — an undiscounted pipeline total is the number that makes a funding
   * plan look healthy right up until nothing lands.
   */
  function rollup(rows) {
    rows = rows || [];
    let secured = 0, weighted = 0, liveCount = 0, wonCount = 0;

    rows.forEach(r => {
      const mid = midpointAmount(r);
      if (WON_STAGES.includes(r.stage)) {
        wonCount++;
        secured += Number(r.amount_awarded) || mid;
      } else if (LIVE_STAGES.includes(r.stage)) {
        liveCount++;
        // probability criterion is 0-10; treat absent as 50/50 rather than
        // as certainty in either direction.
        const p = r.scorecard && r.scorecard.probability !== undefined
          ? Number(r.scorecard.probability) / 10
          : 0.5;
        weighted += mid * (isFinite(p) ? p : 0.5);
      }
    });

    return {
      secured: Math.round(secured),
      weightedPipeline: Math.round(weighted),
      liveCount,
      wonCount,
      total: rows.length,
    };
  }

  function midpointAmount(r) {
    const lo = Number(r.amount_min) || 0;
    const hi = Number(r.amount_max) || 0;
    if (lo && hi) return (lo + hi) / 2;
    return hi || lo || 0;
  }

  /**
   * The 36-month targets. Deliberately expressed as ranges, matching how they
   * were set — a single number would imply a precision that was never there.
   */
  const TARGETS = [
    { year: 1, min: 150000,  max: 300000,
      via: 'R&D incentives, smaller programs, council projects, export preparation' },
    { year: 2, min: 500000,  max: 1000000,
      via: 'Research partnerships, government programs, tenders, international expansion assistance' },
    { year: 3, min: 1000000, max: 3000000,
      via: 'Larger AI/productivity programs, collaborative R&D, government procurement' },
  ];

  return {
    STAGES, LEVELS, WON_STAGES, LIVE_STAGES, TARGETS,
    list, create, update, remove, rollup, midpointAmount, isCloud,
  };
})();
