/**
 * MissionStore — the missing shared state for a Scotty "mission" (a
 * multi-agent plan running Scotty -> ... -> Pat).
 *
 * Previously a mission's plan, per-step results, and end-of-mission digest
 * lived only as in-memory JS on the ScottyChat instance in web/scotty.html —
 * a page refresh lost everything, and no other agent page had any way to
 * know "is there a mission in progress, and what's my part in it". This is
 * deliberately localStorage-only, not a Supabase store like ContactsStore/
 * SocialPostsStore: a mission is single-user, single-device, short-lived
 * scratch state (its useful lifetime is "however long today's session
 * takes"), not durable cross-device business data.
 *
 * Shape:
 *   {
 *     id, goal, createdAt, status: 'planning'|'in_progress'|'complete',
 *     steps: [{ agentKey, taskName, objective,
 *               status: 'pending'|'in_progress'|'done'|'skipped',
 *               resultSummary, resultRef, completedAt }],
 *     finalDelivery: { agentKey, ref } | null
 *   }
 */
window.MissionStore = (function () {
  'use strict';

  const KEY = 'audema_active_mission';

  function read() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  function write(mission) {
    try { localStorage.setItem(KEY, JSON.stringify(mission)); } catch { /* storage full/blocked — mission just won't persist */ }
    return mission;
  }

  function uid() {
    return 'mission_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  /**
   * @param {string} goal - the user's plain-language goal
   * @param {Array<{agentKey, taskName, objective}>} steps
   */
  function create(goal, steps) {
    const mission = {
      id: uid(),
      goal: goal || '',
      createdAt: new Date().toISOString(),
      status: 'planning',
      steps: (steps || []).map(s => ({
        agentKey: s.agentKey,
        taskName: s.taskName || '',
        objective: s.objective || '',
        status: 'pending',
        resultSummary: null,
        resultRef: null,
        completedAt: null,
      })),
      finalDelivery: null,
    };
    return write(mission);
  }

  function get(id) {
    const m = read();
    return (m && m.id === id) ? m : null;
  }

  /** The one mission a novice cares about — "what am I doing right now". */
  function getActive() {
    const m = read();
    if (!m || m.status === 'complete') return null;
    return m;
  }

  function updateStep(id, agentKey, patch) {
    const m = get(id) || getActive();
    if (!m || m.id !== id) return null;
    const step = m.steps.find(s => s.agentKey === agentKey);
    if (!step) return m;
    Object.assign(step, patch);
    if (patch.status === 'done' || patch.status === 'skipped') step.completedAt = new Date().toISOString();
    if (m.status === 'planning') m.status = 'in_progress';
    return write(m);
  }

  function setFinalDelivery(id, agentKey, ref) {
    const m = get(id) || getActive();
    if (!m || m.id !== id) return null;
    m.finalDelivery = { agentKey, ref };
    return write(m);
  }

  function complete(id) {
    const m = get(id) || getActive();
    if (!m || m.id !== id) return null;
    m.status = 'complete';
    return write(m);
  }

  /** Dismiss the active mission without marking it "complete" (e.g. user starts a new one). */
  function clearActive() {
    try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  }

  return { create, get, getActive, updateStep, setFinalDelivery, complete, clearActive };
})();
