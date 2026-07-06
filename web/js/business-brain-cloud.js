/**
 * BusinessBrainCloud — per-project cloud sync + version history for BusinessBrain
 *
 * Talks directly to Supabase (client-side, RLS-protected) using the same
 * shared client as project-service.js / supabase-client.js. BusinessBrain
 * itself stays localStorage-backed for instant synchronous reads (many call
 * sites in the app call brain.load() synchronously), but every save is
 * mirrored to Supabase here — scoped per-project, with an append-only
 * history so a bad autofill overwrite or accidental edit can be rolled back.
 *
 * Tables (see supabase-business-brain.sql):
 *   business_brain          — one row per project, current state
 *   business_brain_history  — append-only snapshot log, capped at 20/project
 */
window.BusinessBrainCloud = (function () {
  'use strict';

  const MAX_HISTORY = 20;
  const LEGACY_KEY  = 'intel_business_brain'; // pre-migration global key

  function getSupabase() {
    if (window.Supabase?.getClient) return window.Supabase.getClient();
    return null;
  }

  async function getCurrentUserId() {
    const client = getSupabase();
    if (!client) return null;
    try {
      const { data: { user } } = await client.auth.getUser();
      return user?.id || null;
    } catch { return null; }
  }

  /** Reads the same current-project pointer that project-service.js maintains. */
  function getCurrentProjectId() {
    return localStorage.getItem('seo-current-project') || null;
  }

  /**
   * Pull the latest cloud brain for a project. Returns null if none exists
   * or the user isn't authenticated / Supabase isn't configured.
   */
  async function pullLatest(projectId) {
    const client = getSupabase();
    if (!client || !projectId) return null;

    try {
      const { data, error } = await client
        .from('business_brain')
        .select('data, confidence_score, updated_at')
        .eq('project_id', projectId)
        .maybeSingle();

      if (error || !data) return null;
      return data;
    } catch (e) {
      console.warn('[BusinessBrainCloud] pullLatest failed:', e.message);
      return null;
    }
  }

  /**
   * Save current state to Supabase and append a history snapshot.
   * Fire-and-forget safe — never throws, resolves false on failure.
   */
  async function pushSnapshot(projectId, data, confidenceScore, label) {
    const client = getSupabase();
    if (!client || !projectId) return false;

    const userId = await getCurrentUserId();
    if (!userId) return false;

    try {
      await client.from('business_brain').upsert({
        project_id:       projectId,
        user_id:          userId,
        data,
        confidence_score: confidenceScore || 0,
      }, { onConflict: 'project_id' });

      await client.from('business_brain_history').insert({
        project_id:       projectId,
        user_id:          userId,
        data,
        confidence_score: confidenceScore || 0,
        label:            label || 'Autosave',
      });

      // Prune to last MAX_HISTORY snapshots for this project
      const { data: rows } = await client
        .from('business_brain_history')
        .select('id, created_at')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false });

      if (rows && rows.length > MAX_HISTORY) {
        const staleIds = rows.slice(MAX_HISTORY).map(r => r.id);
        if (staleIds.length) {
          await client.from('business_brain_history').delete().in('id', staleIds);
        }
      }

      return true;
    } catch (e) {
      console.warn('[BusinessBrainCloud] pushSnapshot failed:', e.message);
      return false;
    }
  }

  /** List up to MAX_HISTORY snapshots for a project, newest first. */
  async function listHistory(projectId) {
    const client = getSupabase();
    if (!client || !projectId) return [];

    try {
      const { data, error } = await client
        .from('business_brain_history')
        .select('id, data, confidence_score, label, created_at')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
        .limit(MAX_HISTORY);

      if (error) return [];
      return data || [];
    } catch (e) {
      console.warn('[BusinessBrainCloud] listHistory failed:', e.message);
      return [];
    }
  }

  /** Restore a snapshot's data as the current brain state (writes a new history entry marking the restore). */
  async function restoreSnapshot(projectId, snapshotId) {
    const client = getSupabase();
    if (!client || !projectId) throw new Error('Cloud sync not available');

    const { data: snapshot, error } = await client
      .from('business_brain_history')
      .select('data, confidence_score, created_at')
      .eq('id', snapshotId)
      .single();

    if (error || !snapshot) throw new Error('Snapshot not found');

    await pushSnapshot(projectId, snapshot.data, snapshot.confidence_score, `Restored from ${new Date(snapshot.created_at).toLocaleString()}`);
    return snapshot.data;
  }

  /** Check for pre-migration global (non-project-scoped) brain data. */
  function checkLegacyData() {
    try {
      const raw = localStorage.getItem(LEGACY_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const hasContent = parsed?.company?.name || parsed?.icp?.primaryBuyer?.role || parsed?.positioning?.uniqueValue;
      return hasContent ? parsed : null;
    } catch { return null; }
  }

  return {
    getSupabase,
    getCurrentUserId,
    getCurrentProjectId,
    pullLatest,
    pushSnapshot,
    listHistory,
    restoreSnapshot,
    checkLegacyData,
    MAX_HISTORY,
    LEGACY_KEY,
  };
})();
