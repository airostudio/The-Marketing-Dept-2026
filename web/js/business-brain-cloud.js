/**
 * BusinessBrainCloud — cloud sync + version history for BusinessBrain
 *
 * Scope-aware: Business Brain data is scoped to the ACTIVE INTELLIGENCE
 * PROFILE when one is selected (multi-business support, plan-limited), and
 * falls back to the legacy per-project scope for accounts that haven't
 * adopted profiles. BusinessBrain itself stays localStorage-backed for
 * instant synchronous reads; every save is mirrored to Supabase here with
 * an append-only history (last 20 snapshots per scope).
 *
 * A scope is { profileId } or { projectId } — see getScope().
 *
 * Tables (supabase-business-brain.sql + supabase-intelligence-profiles.sql):
 *   business_brain          — one row per profile (or legacy project)
 *   business_brain_history  — append-only snapshot log, capped at 20/scope
 */
window.BusinessBrainCloud = (function () {
  'use strict';

  const MAX_HISTORY = 20;
  const LEGACY_KEY  = 'intel_business_brain'; // pre-migration global key

  async function getSupabase() {
    if (window.Supabase?.ready) { try { await window.Supabase.ready(); } catch { /* fall through to getClient() below */ } }
    if (window.Supabase?.getClient) return window.Supabase.getClient();
    return null;
  }

  // Same getUser()-with-getSession()-fallback fix applied to
  // IntelligenceProfiles/NancyStore/SocialPostsStore: auth.getUser() can
  // transiently fail right after a fresh login even with a valid session,
  // and this function has no fallback, so a caller like getScope()'s
  // callers can read "signed out" when the user genuinely isn't.
  async function getCurrentUserId() {
    const client = await getSupabase();
    if (!client) return null;
    try {
      const { data: { user }, error } = await client.auth.getUser();
      if (user) return user.id;
      if (error) throw error;
    } catch (err) {
      console.warn('[BusinessBrainCloud] auth.getUser() failed, falling back to cached session:', err.message);
    }
    try {
      const { data: { session } } = await client.auth.getSession();
      return session?.user?.id || null;
    } catch { return null; }
  }

  /** Active scope: intelligence profile first, legacy project fallback. */
  function getScope() {
    const profileId = localStorage.getItem('intel_active_profile');
    if (profileId) return { profileId };
    const projectId = localStorage.getItem('seo-current-project');
    if (projectId) return { projectId };
    return null;
  }

  /** Legacy helper kept for older call sites. */
  function getCurrentProjectId() {
    return localStorage.getItem('seo-current-project') || null;
  }

  function scopeFilter(query, scope) {
    return scope.profileId
      ? query.eq('intel_profile_id', scope.profileId)
      : query.eq('project_id', scope.projectId);
  }

  function scopeColumns(scope) {
    return scope.profileId
      ? { intel_profile_id: scope.profileId }
      : { project_id: scope.projectId };
  }

  /** Pull the latest cloud brain for a scope. Null if none / offline. */
  async function pullLatest(scope) {
    const client = await getSupabase();
    if (!client || !scope) return null;

    try {
      let q = client.from('business_brain').select('data, confidence_score, updated_at');
      q = scopeFilter(q, scope);
      const { data, error } = await q.maybeSingle();
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
  async function pushSnapshot(scope, data, confidenceScore, label) {
    const client = await getSupabase();
    if (!client || !scope) return false;

    const userId = await getCurrentUserId();
    if (!userId) return false;

    const cols = scopeColumns(scope);

    try {
      await client.from('business_brain').upsert({
        ...cols,
        user_id:          userId,
        data,
        confidence_score: confidenceScore || 0,
      }, { onConflict: scope.profileId ? 'intel_profile_id' : 'project_id' });

      await client.from('business_brain_history').insert({
        ...cols,
        user_id:          userId,
        data,
        confidence_score: confidenceScore || 0,
        label:            label || 'Autosave',
      });

      // Prune to last MAX_HISTORY snapshots for this scope
      let hq = client.from('business_brain_history').select('id, created_at');
      hq = scopeFilter(hq, scope);
      const { data: rows } = await hq.order('created_at', { ascending: false });

      if (rows && rows.length > MAX_HISTORY) {
        const staleIds = rows.slice(MAX_HISTORY).map(r => r.id);
        if (staleIds.length) {
          await client.from('business_brain_history').delete().in('id', staleIds);
        }
      }

      return true;
    } catch (e) {
      // Common cause: an account whose Supabase project hasn't had
      // supabase-intelligence-profiles.sql run yet. That migration is what
      // adds business_brain.intel_profile_id and its unique index — without
      // it, upserting with { intel_profile_id: ... } either 404s with
      // "column intel_profile_id does not exist" or fails a NOT NULL
      // constraint on project_id (the pre-profiles schema required it).
      // Both surface here as a plain error with no other symptom in the UI.
      console.warn('[BusinessBrainCloud] pushSnapshot failed — if this mentions intel_profile_id or a NOT NULL constraint on project_id, run supabase-intelligence-profiles.sql against this Supabase project:', e.message);
      return false;
    }
  }

  /** List up to MAX_HISTORY snapshots for a scope, newest first. */
  async function listHistory(scope) {
    const client = await getSupabase();
    if (!client || !scope) return [];

    try {
      let q = client.from('business_brain_history')
        .select('id, data, confidence_score, label, created_at');
      q = scopeFilter(q, scope);
      const { data, error } = await q.order('created_at', { ascending: false }).limit(MAX_HISTORY);
      if (error) return [];
      return data || [];
    } catch (e) {
      console.warn('[BusinessBrainCloud] listHistory failed:', e.message);
      return [];
    }
  }

  /** Restore a snapshot as current state (records the restore in history). */
  async function restoreSnapshot(scope, snapshotId) {
    const client = await getSupabase();
    if (!client || !scope) throw new Error('Cloud sync not available');

    const { data: snapshot, error } = await client
      .from('business_brain_history')
      .select('data, confidence_score, created_at')
      .eq('id', snapshotId)
      .single();

    if (error || !snapshot) throw new Error('Snapshot not found');

    await pushSnapshot(scope, snapshot.data, snapshot.confidence_score,
      `Restored from ${new Date(snapshot.created_at).toLocaleString()}`);
    return snapshot.data;
  }

  /**
   * Work out WHY cloud sync is unavailable, precisely.
   *
   * getScope() returning null has several very different causes that all
   * used to surface as the same "Sign in and select a profile" message —
   * which is actively misleading for a signed-in user who has no way to
   * select a profile because the table backing profiles doesn't exist yet.
   * This probes each layer and reports the real one.
   *
   * @returns {Promise<{ok: boolean, reason: string, message: string}>}
   */
  async function diagnose() {
    const client = await getSupabase();
    if (!client) {
      return {
        ok: false,
        reason: 'not-configured',
        message: 'Cloud sync is not configured for this deployment (no Supabase URL/key). Contact support — nothing you do on this page will sync until that is set.',
      };
    }

    const userId = await getCurrentUserId();
    if (!userId) {
      return {
        ok: false,
        reason: 'signed-out',
        message: 'You are not signed in to the cloud on this page. Sign in and reload.',
      };
    }

    const scope = getScope();
    if (scope) {
      return { ok: true, reason: 'ok', message: 'Cloud sync is active.' };
    }

    // Signed in but no scope — find out whether the profiles table is even
    // reachable. A missing table (migration never run) is by far the most
    // common cause and is invisible from the UI otherwise.
    try {
      const { error } = await client.from('intelligence_profiles').select('id').limit(1);
      if (error) {
        const msg = (error.message || '').toLowerCase();
        if (msg.includes('does not exist') || msg.includes('schema cache') || error.code === '42P01') {
          return {
            ok: false,
            reason: 'missing-migration',
            message: 'Your database is missing the intelligence-profiles tables, so no profile can be created and nothing can sync. Run supabase-intelligence-profiles.sql against this Supabase project, then reload.',
          };
        }
        return {
          ok: false,
          reason: 'profiles-error',
          message: 'Could not read intelligence profiles: ' + error.message,
        };
      }
    } catch (e) {
      return {
        ok: false,
        reason: 'profiles-error',
        message: 'Could not read intelligence profiles: ' + e.message,
      };
    }

    // Table exists and is readable, but no profile is active — this is the
    // only case where the original "select a profile" advice is correct.
    return {
      ok: false,
      reason: 'no-active-profile',
      message: 'No intelligence profile is selected yet. Create or select one above, then come back here.',
    };
  }

  /** Check for pre-migration global (unscoped) brain data. */
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
    getScope,
    diagnose,
    pullLatest,
    pushSnapshot,
    listHistory,
    restoreSnapshot,
    checkLegacyData,
    MAX_HISTORY,
    LEGACY_KEY,
  };
})();
