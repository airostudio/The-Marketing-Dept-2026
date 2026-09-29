/**
 * CompetitiveRosterStore — cloud persistence for Competitive Command's
 * roster, market gaps and battlecards.
 *
 * These lived in localStorage only ('tmd_radar', 'tmd_ci_gaps',
 * 'tmd_ci_battlecards'), so a team's whole competitive picture — positioning,
 * threat levels, logged moves, gap scores, generated battlecards — existed on
 * one browser on one machine. Clearing site data destroyed it; a second device
 * or a colleague on the same account saw an empty page.
 *
 * See supabase-competitive-roster.sql for the schema and RLS.
 *
 * Two deliberate choices:
 *
 *   1. localStorage is kept as a write-through cache, not dropped. The page
 *      renders from it synchronously on load, so the roster appears instantly
 *      and still works if Supabase is briefly unreachable — but the cloud is
 *      the source of truth and overwrites the cache as soon as it answers.
 *
 *   2. A save that fails is reported, never swallowed. Silently keeping a
 *      local-only copy while the customer believes it synced is how the
 *      original problem would quietly survive the fix.
 */
window.CompetitiveRosterStore = (function () {
  'use strict';

  const KEYS = {
    competitor: 'tmd_radar',
    gap:        'tmd_ci_gaps',
    battlecard: 'tmd_ci_battlecards',
  };
  const MIGRATED_FLAG = 'tmd_ci_migrated_v1';

  async function getSupabase() {
    if (window.Supabase?.ready) { try { await window.Supabase.ready(); } catch { /* fall through */ } }
    return window.Supabase?.getClient?.() || null;
  }

  // Same getUser()-then-getSession() fallback as the other stores: getUser()
  // can transiently fail right after a fresh login even with a valid session.
  async function getUserId() {
    const client = await getSupabase();
    if (!client) return null;
    try {
      const { data: { user }, error } = await client.auth.getUser();
      if (user) return user.id;
      if (error) throw error;
    } catch (err) {
      console.warn('[CompetitiveRosterStore] auth.getUser() failed, trying cached session:', err.message);
    }
    try {
      const { data: { session } } = await client.auth.getSession();
      return session?.user?.id || null;
    } catch { return null; }
  }

  // A project created offline gets a locally generated id ('local_…'), which
  // is not a database row — using it as a scope sends a non-UUID into a uuid
  // foreign key and every insert fails. Treat it as no scope at all.
  function isCloudId(id) { return !!id && !String(id).startsWith('local_'); }

  function getScope() {
    const profileId = localStorage.getItem('intel_active_profile');
    if (isCloudId(profileId)) return { intel_profile_id: profileId };
    const projectId = localStorage.getItem('seo-current-project');
    if (isCloudId(projectId)) return { project_id: projectId };
    return {};
  }

  /* ── local cache ─────────────────────────────────────────────────────── */

  function cacheRead(kind) {
    try {
      const raw = localStorage.getItem(KEYS[kind]);
      if (!raw) return kind === 'battlecard' ? {} : [];
      const parsed = JSON.parse(raw);
      return parsed ?? (kind === 'battlecard' ? {} : []);
    } catch {
      return kind === 'battlecard' ? {} : [];
    }
  }

  function cacheWrite(kind, value) {
    try { localStorage.setItem(KEYS[kind], JSON.stringify(value)); } catch { /* quota or private mode */ }
  }

  /* ── cloud ───────────────────────────────────────────────────────────── */

  function scopeFilter(query, scope) {
    if (scope.intel_profile_id) return query.eq('intel_profile_id', scope.intel_profile_id);
    if (scope.project_id)       return query.eq('project_id', scope.project_id);
    // No profile or project chosen yet: the user's own unscoped records.
    return query.is('intel_profile_id', null).is('project_id', null);
  }

  /**
   * Every record of one kind for the active scope.
   * Returns null — not an empty list — when the cloud could not be reached, so
   * callers can tell "you have no competitors" from "we could not look".
   */
  async function fetchKind(kind) {
    const client = await getSupabase();
    const userId = await getUserId();
    if (!client || !userId) return null;
    const scope = getScope();
    let q = client.from('competitive_roster')
      .select('client_id, payload, updated_at')
      .eq('kind', kind);
    q = scopeFilter(q, scope);
    const { data, error } = await q.order('created_at', { ascending: true });
    if (error) {
      console.warn('[CompetitiveRosterStore] load ' + kind + ' failed:', error.message);
      return null;
    }
    return data || [];
  }

  async function upsertMany(kind, records) {
    const client = await getSupabase();
    const userId = await getUserId();
    if (!client || !userId) throw new Error('Sign in to save your competitive roster.');
    if (!records.length) return true;
    const scope = getScope();
    const rows = records.map(r => ({
      user_id: userId,
      project_id: scope.project_id || null,
      intel_profile_id: scope.intel_profile_id || null,
      kind,
      client_id: String(r.client_id),
      payload: r.payload,
    }));
    const { error } = await client.from('competitive_roster')
      .upsert(rows, { onConflict: 'user_id,kind,client_id' });
    if (error) throw new Error(error.message);
    return true;
  }

  async function deleteMissing(kind, keepIds) {
    const client = await getSupabase();
    const userId = await getUserId();
    if (!client || !userId) return;
    let q = client.from('competitive_roster').delete().eq('kind', kind).eq('user_id', userId);
    q = scopeFilter(q, getScope());
    if (keepIds.length) q = q.not('client_id', 'in', '(' + keepIds.map(id => '"' + id + '"').join(',') + ')');
    const { error } = await q;
    if (error) console.warn('[CompetitiveRosterStore] prune ' + kind + ' failed:', error.message);
  }

  /* ── public API ──────────────────────────────────────────────────────── */

  /**
   * Read a kind. Returns the cloud copy when available and refreshes the
   * local cache from it; falls back to the cache when offline or signed out.
   * @returns {Promise<{ items: Array|Object, source: 'cloud'|'cache', synced: boolean }>}
   */
  async function load(kind) {
    const rows = await fetchKind(kind);
    if (rows === null) {
      return { items: cacheRead(kind), source: 'cache', synced: false };
    }
    if (kind === 'battlecard') {
      const map = {};
      rows.forEach(r => { map[r.client_id] = r.payload?.content ?? r.payload; });
      cacheWrite(kind, map);
      return { items: map, source: 'cloud', synced: true };
    }
    const list = rows.map(r => r.payload);
    cacheWrite(kind, list);
    return { items: list, source: 'cloud', synced: true };
  }

  /**
   * Write a kind. The cache is updated first so the UI stays responsive, then
   * the cloud. A cloud failure throws — the caller must tell the customer,
   * because a save they believe happened and did not is the original bug.
   */
  async function save(kind, value) {
    cacheWrite(kind, value);
    const records = (kind === 'battlecard')
      ? Object.entries(value || {}).map(([id, content]) => ({ client_id: id, payload: { content } }))
      : (value || []).map(item => ({ client_id: item.id, payload: item }));
    await upsertMany(kind, records);
    await deleteMissing(kind, records.map(r => String(r.client_id)));
    return true;
  }

  /**
   * One-time lift of whatever is already in localStorage into the cloud.
   *
   * Runs only when the cloud has nothing for this scope — so it never
   * overwrites a roster a colleague built with a stale copy from this browser.
   * Marked done per user+scope so a later local edit is not re-migrated over
   * the top of newer cloud data.
   */
  async function migrateLocal() {
    const userId = await getUserId();
    if (!userId) return { migrated: false, reason: 'not signed in' };
    const scope = getScope();
    const flag = MIGRATED_FLAG + ':' + userId + ':' +
      (scope.intel_profile_id || scope.project_id || 'none');
    try { if (localStorage.getItem(flag)) return { migrated: false, reason: 'already done' }; } catch { /* ignore */ }

    const result = { migrated: false, counts: {} };
    for (const kind of ['competitor', 'gap', 'battlecard']) {
      const local = cacheRead(kind);
      const hasLocal = kind === 'battlecard'
        ? Object.keys(local || {}).length > 0
        : Array.isArray(local) && local.length > 0;
      if (!hasLocal) continue;

      const remote = await fetchKind(kind);
      if (remote === null) return { migrated: false, reason: 'cloud unreachable' };
      // Anything already in the cloud wins. A local copy is only ever a
      // starting point, never something that overwrites shared work.
      if (remote.length) continue;

      await save(kind, local);
      result.counts[kind] = kind === 'battlecard' ? Object.keys(local).length : local.length;
      result.migrated = true;
    }
    try { localStorage.setItem(flag, new Date().toISOString()); } catch { /* ignore */ }
    return result;
  }

  return {
    load, save, migrateLocal, getScope, getUserId,
    // Exposed for callers that want the instant local copy before the cloud
    // round-trip completes.
    cacheRead,
  };
})();
