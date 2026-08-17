/**
 * ExperimentsStore — wires CRO Lab to the A/B testing infrastructure that
 * already existed (supabase-ab-testing.sql, api/ab-track.js) but had no
 * browser UI pointed at it. CRO Lab could design a test (ICE score, sample
 * size, stat-sig calculator) but never actually launch one or see real
 * results — this is that missing link.
 *
 * Same client-side-Supabase-calls-secured-by-RLS pattern as ContactsStore /
 * SocialPostsStore. experiments/variants/goals are read/written directly by
 * the signed-in user (RLS: auth.uid() = user_id); the actual visitor/
 * conversion tracking always goes through api/ab-track.js (unauthenticated
 * visitors, service-role key server-side) — this module never touches those
 * two tables directly except to read aggregate counts for a results view.
 */
window.ExperimentsStore = (function () {
  'use strict';

  function getSupabase() {
    return window.Supabase?.getClient?.() || null;
  }

  async function getUserId() {
    const client = getSupabase();
    if (!client) return null;
    try {
      const { data: { user } } = await client.auth.getUser();
      return user?.id || null;
    } catch { return null; }
  }

  /* ─────────────────────────────────────────────────────────────────────────
     EXPERIMENTS
  ───────────────────────────────────────────────────────────────────────── */

  /**
   * Creates an experiment with its variants and a single primary goal.
   * @param {{name, description?, variants: Array<{name, isControl?}>, goal: {name, type, selector?, urlPattern?}}} input
   * @returns {Promise<{id, name, variants, goal}>}
   */
  async function createExperiment({ name, description, variants, goal }) {
    const client = getSupabase();
    const userId = await getUserId();
    if (!client || !userId) throw new Error('Sign in to create an experiment.');
    if (!name) throw new Error('Experiment name is required.');
    if (!variants || variants.length < 2) throw new Error('At least 2 variants are required (control + at least one challenger).');
    if (!goal || !goal.name) throw new Error('A primary goal is required.');

    const { data: exp, error: expErr } = await client
      .from('experiments')
      .insert({ name, description: description || '', status: 'draft', type: 'ab', user_id: userId })
      .select()
      .single();
    if (expErr) throw new Error(expErr.message);

    const allocation = +(100 / variants.length).toFixed(2);
    const { data: variantRows, error: varErr } = await client
      .from('variants')
      .insert(variants.map((v, i) => ({
        experiment_id: exp.id,
        name: v.name,
        is_control: i === 0,
        traffic_allocation: allocation,
      })))
      .select();
    if (varErr) throw new Error(varErr.message);

    const { data: goalRow, error: goalErr } = await client
      .from('goals')
      .insert({
        experiment_id: exp.id,
        name: goal.name,
        type: goal.type || 'click',
        selector: goal.selector || null,
        url_pattern: goal.urlPattern || null,
        is_primary: true,
      })
      .select()
      .single();
    if (goalErr) throw new Error(goalErr.message);

    await client.from('experiments').update({ primary_goal_id: goalRow.id }).eq('id', exp.id);

    return { id: exp.id, name: exp.name, variants: variantRows, goal: goalRow };
  }

  async function listExperiments() {
    const client = getSupabase();
    const userId = await getUserId();
    if (!client || !userId) return [];
    const { data, error } = await client
      .from('experiments')
      .select('*, variants(*), goals(*)')
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return data || [];
  }

  async function setStatus(experimentId, status) {
    const client = getSupabase();
    if (!client) throw new Error('Not connected.');
    const patch = { status };
    if (status === 'active') patch.start_date = new Date().toISOString();
    if (status === 'finished') patch.end_date = new Date().toISOString();
    const { error } = await client.from('experiments').update(patch).eq('id', experimentId);
    if (error) throw new Error(error.message);
  }

  async function declareWinner(experimentId, variantId) {
    const client = getSupabase();
    if (!client) throw new Error('Not connected.');
    const { error } = await client
      .from('experiments')
      .update({ status: 'finished', winner_variant_id: variantId, end_date: new Date().toISOString() })
      .eq('id', experimentId);
    if (error) throw new Error(error.message);
  }

  async function deleteExperiment(experimentId) {
    const client = getSupabase();
    if (!client) throw new Error('Not connected.');
    const { error } = await client.from('experiments').delete().eq('id', experimentId);
    if (error) throw new Error(error.message);
  }

  /* ─────────────────────────────────────────────────────────────────────────
     RESULTS — real visitor/conversion counts per variant, feeding straight
     into the same z-test the Stat Sig Calculator already runs on manually-
     typed numbers.
  ───────────────────────────────────────────────────────────────────────── */

  async function getResults(experimentId) {
    const client = getSupabase();
    if (!client) throw new Error('Not connected.');

    const [{ data: variants, error: vErr }, { data: visitors, error: visErr }, { data: conversions, error: convErr }] = await Promise.all([
      client.from('variants').select('*').eq('experiment_id', experimentId),
      client.from('visitors').select('variant_id').eq('experiment_id', experimentId),
      client.from('conversions').select('variant_id, revenue').eq('experiment_id', experimentId),
    ]);
    if (vErr) throw new Error(vErr.message);
    if (visErr) throw new Error(visErr.message);
    if (convErr) throw new Error(convErr.message);

    return (variants || []).map(v => {
      const visitorCount = (visitors || []).filter(x => x.variant_id === v.id).length;
      const variantConversions = (conversions || []).filter(x => x.variant_id === v.id);
      const conversionCount = variantConversions.length;
      const revenue = variantConversions.reduce((sum, c) => sum + (Number(c.revenue) || 0), 0);
      return {
        id: v.id,
        name: v.name,
        isControl: v.is_control,
        visitors: visitorCount,
        conversions: conversionCount,
        convRate: visitorCount > 0 ? (conversionCount / visitorCount * 100) : null,
        revenue,
      };
    });
  }

  /* ─────────────────────────────────────────────────────────────────────────
     TRACKING SNIPPET — deterministically buckets a visitor into a variant
     by traffic_allocation, POSTs the assignment to api/ab-track.js on load,
     and exposes window.audemaConvert(goalId) for the page to call when the
     visitor completes the goal action.
  ───────────────────────────────────────────────────────────────────────── */

  function buildSnippet(experiment) {
    const variants = experiment.variants || [];
    const goal = (experiment.goals && experiment.goals[0]) || experiment.goal;
    const config = {
      experimentId: experiment.id,
      goalId: goal ? goal.id : null,
      variants: variants.map(v => ({ id: v.id, name: v.name, weight: Number(v.traffic_allocation) || (100 / variants.length) })),
    };

    return `<script>
(function () {
  var CFG = ${JSON.stringify(config, null, 2)};
  var STORAGE_KEY = 'audema_ab_' + CFG.experimentId;
  var VISITOR_KEY = 'audema_visitor_id';

  function uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  function pickVariant() {
    var totalWeight = CFG.variants.reduce(function (s, v) { return s + v.weight; }, 0);
    var roll = Math.random() * totalWeight;
    var acc = 0;
    for (var i = 0; i < CFG.variants.length; i++) {
      acc += CFG.variants[i].weight;
      if (roll <= acc) return CFG.variants[i];
    }
    return CFG.variants[CFG.variants.length - 1];
  }

  var visitorId = localStorage.getItem(VISITOR_KEY);
  if (!visitorId) { visitorId = uuid(); localStorage.setItem(VISITOR_KEY, visitorId); }

  var assignment = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
  if (!assignment) {
    assignment = pickVariant();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(assignment));
  }

  window.audemaExperimentVariant = assignment; // { id, name, weight } — branch your page logic on assignment.name

  fetch('${(window.location && window.location.origin) || ''}/api/ab-track', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    keepalive: true,
    body: JSON.stringify({ type: 'visit', experimentId: CFG.experimentId, variantId: assignment.id, visitorId: visitorId }),
  }).catch(function () {});

  // Call this when the visitor completes the goal action, e.g.:
  // document.querySelector('#buy-button').addEventListener('click', function () { window.audemaConvert(); });
  window.audemaConvert = function (revenue) {
    fetch('${(window.location && window.location.origin) || ''}/api/ab-track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({ type: 'convert', experimentId: CFG.experimentId, variantId: assignment.id, visitorId: visitorId, goalId: CFG.goalId, revenue: revenue || null }),
    }).catch(function () {});
  };
})();
<\/script>`;
  }

  return {
    createExperiment,
    listExperiments,
    setStatus,
    declareWinner,
    deleteExperiment,
    getResults,
    buildSnippet,
  };
})();
