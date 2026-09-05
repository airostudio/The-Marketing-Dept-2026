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

  /* ─────────────────────────────────────────────────────────────────────
     PENDING APPROVALS — automations Scotty classified as consequential
     (send/publish/spend/delete) and won't run without an explicit click.

     Previously these lived only as an in-memory array inside
     _renderAutomationPanel() in scotty.html — refresh the tab, or just
     navigate away, and an item awaiting approval vanished with no record
     anywhere, even though the work it described still needed doing.
     Deliberately a separate top-level bucket, not nested under the single
     active-mission slot above: an automation can be proposed from either a
     full mission OR a single-agent dispatch follow-up (no mission object
     exists in that second case), and approvals shouldn't disappear the
     moment a mission is marked complete (which happens before the
     automation-assessment phase even runs).
     ───────────────────────────────────────────────────────────────────── */

  const APPROVALS_KEY = 'audema_pending_approvals';
  const MAX_APPROVALS = 100;

  function readApprovals() {
    try { return JSON.parse(localStorage.getItem(APPROVALS_KEY) || '[]'); } catch { return []; }
  }

  function writeApprovals(list) {
    // Bound growth by dropping the oldest already-resolved entries first —
    // never drop a still-pending one just to make room.
    if (list.length > MAX_APPROVALS) {
      const pending = list.filter(a => a.status === 'pending');
      const resolved = list.filter(a => a.status !== 'pending');
      resolved.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      list = pending.concat(resolved.slice(-(MAX_APPROVALS - pending.length)));
    }
    try { localStorage.setItem(APPROVALS_KEY, JSON.stringify(list)); } catch { /* storage full/blocked */ }
    return list;
  }

  /**
   * @param {Array<{id, agentKey, title, description, impact, timeEstimate, deliverable, prompt}>} approvals
   * @param {string} [missionId] - the mission this came from, if any (null for a single-agent dispatch follow-up)
   */
  function addPendingApprovals(approvals, missionId) {
    const list = readApprovals();
    (approvals || []).forEach(a => {
      // The LLM-generated `id` (e.g. "auto_email_seq") is only unique
      // within one assessment call, not across every mission that's ever
      // run — a later mission proposing the "same" idea would otherwise
      // silently collide with an unrelated earlier entry.
      const uniqueId = uid() + '_' + (a.id || a.agentKey);
      list.push(Object.assign({}, a, {
        id: uniqueId, missionId: missionId || null,
        status: 'pending', createdAt: new Date().toISOString(), resolvedAt: null,
      }));
      // Stamped back onto the caller's own object (scotty.html holds these
      // in a plain in-memory array to wire up its "Run this" buttons) so
      // resolveApproval() can be called with the right id once the user
      // actually clicks, without the caller needing to re-derive it.
      a._persistedApprovalId = uniqueId;
    });
    return writeApprovals(list);
  }

  /** Everything still awaiting a decision, oldest first. */
  function getPendingApprovals() {
    return readApprovals()
      .filter(a => a.status === 'pending')
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  }

  function resolveApproval(id, status) {
    const list = readApprovals();
    const a = list.find(x => x.id === id);
    if (!a) return list;
    a.status = status; // 'approved' | 'dismissed'
    a.resolvedAt = new Date().toISOString();
    return writeApprovals(list);
  }

  return {
    create, get, getActive, updateStep, setFinalDelivery, complete, clearActive,
    addPendingApprovals, getPendingApprovals, resolveApproval,
  };
})();
