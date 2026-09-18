/**
 * CroBacklogStore — cloud persistence for CRO Lab's ICE-scored test backlog.
 *
 * The backlog lived in localStorage while the experiments beside it on the
 * same page were already cloud-backed, so half of the CRO workflow was shared
 * with the team and half was stranded on one browser. The backlog is the half
 * a team actually collaborates on: it is the prioritised list they argue over
 * and work down, and each row can be dispatched to Scotty as a mission.
 *
 * Same contract as CompetitiveRosterStore and VideoGenStore: localStorage
 * stays as a write-through cache so reads remain synchronous and the existing
 * call sites are unchanged, the cloud is the source of truth, a failed write
 * is surfaced rather than swallowed, and a local list is lifted up once
 * without ever overwriting what the cloud already holds.
 *
 * See supabase-cro-backlog.sql for the schema and RLS.
 */
window.CroBacklogStore = (function () {
  'use strict';

  const KEY = 'cro_ice_tests';
  const MIGRATED_FLAG = 'cro_ice_migrated_v1';

  let synced = false;
  let onSyncChange = null;

  /* ── local cache ─────────────────────────────────────────────────────── */

  function cacheRead() {
    try { return JSON.parse(localStorage.getItem(KEY) || '[]') || []; } catch { return []; }
  }

  function cacheWrite(items) {
    try { localStorage.setItem(KEY, JSON.stringify(items)); } catch { /* quota or private mode */ }
  }

  /* ── cloud ───────────────────────────────────────────────────────────── */

  async function getSupabase() {
    if (window.Supabase?.ready) { try { await window.Supabase.ready(); } catch { /* fall through */ } }
    return window.Supabase?.getClient?.() || null;
  }

  async function getUserId() {
    const client = await getSupabase();
    if (!client) return null;
    try {
      const { data: { user }, error } = await client.auth.getUser();
      if (user) return user.id;
      if (error) throw error;
    } catch (err) {
      console.warn('[CroBacklogStore] auth.getUser() failed, trying cached session:', err.message);
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

  function scopeFilter(query, scope) {
    if (scope.intel_profile_id) return query.eq('intel_profile_id', scope.intel_profile_id);
    if (scope.project_id)       return query.eq('project_id', scope.project_id);
    return query.is('intel_profile_id', null).is('project_id', null);
  }

  /** Clamp to the 1-10 the table constrains, so a bad value never reaches it. */
  function score(v) {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? Math.min(10, Math.max(1, n)) : 5;
  }

  function toRow(item, userId, scope) {
    return {
      user_id: userId,
      project_id: scope.project_id || null,
      intel_profile_id: scope.intel_profile_id || null,
      client_id: String(item.id),
      name: item.name || '',
      impact: score(item.impact),
      confidence: score(item.confidence),
      ease: score(item.ease),
    };
  }

  function fromRow(row) {
    return {
      // The page keys everything off a numeric id; keep it numeric where it
      // started as one so existing comparisons still match.
      id: /^\d+$/.test(row.client_id) ? Number(row.client_id) : row.client_id,
      name: row.name,
      impact: row.impact,
      confidence: row.confidence,
      ease: row.ease,
    };
  }

  function setSyncState(ok, err) {
    synced = ok;
    if (typeof onSyncChange === 'function') {
      try { onSyncChange({ synced: ok, error: err || null }); } catch { /* a UI callback must not break a save */ }
    }
  }

  /** Everything for the active scope, or null when the cloud could not be reached. */
  async function fetchAll() {
    const client = await getSupabase();
    const userId = await getUserId();
    if (!client || !userId) return null;
    let q = client.from('cro_backlog_tests').select('client_id, name, impact, confidence, ease');
    q = scopeFilter(q, getScope());
    const { data, error } = await q.order('created_at', { ascending: true });
    if (error) {
      console.warn('[CroBacklogStore] load failed:', error.message);
      return null;
    }
    return data || [];
  }

  /* ── public API — reads stay synchronous ─────────────────────────────── */

  function list() { return cacheRead(); }

  /**
   * Write the whole backlog. Cache first so the UI stays responsive, then the
   * cloud. A cloud failure is reported through onSyncChange — a save the
   * customer believes happened and did not is the problem this replaces.
   */
  async function save(items) {
    cacheWrite(items);
    const client = await getSupabase();
    const userId = await getUserId();
    if (!client || !userId) { setSyncState(false, null); return false; }

    const scope = getScope();
    const rows = (items || []).map(i => toRow(i, userId, scope));
    if (rows.length) {
      const { error } = await client.from('cro_backlog_tests')
        .upsert(rows, { onConflict: 'user_id,client_id' });
      if (error) { setSyncState(false, error.message); return false; }
    }

    // Remove anything deleted on this device.
    let del = client.from('cro_backlog_tests').delete().eq('user_id', userId);
    del = scopeFilter(del, scope);
    if (rows.length) {
      del = del.not('client_id', 'in', '(' + rows.map(r => '"' + r.client_id + '"').join(',') + ')');
    }
    const { error: delErr } = await del;
    if (delErr) { setSyncState(false, delErr.message); return false; }

    setSyncState(true, null);
    return true;
  }

  /**
   * One-time lift of whatever is already in this browser. Runs only when the
   * cloud holds nothing for this scope, so a local copy can never overwrite a
   * backlog the team built elsewhere.
   */
  async function migrateLocal() {
    const userId = await getUserId();
    if (!userId) return { migrated: false, reason: 'not signed in' };
    const scope = getScope();
    const flag = MIGRATED_FLAG + ':' + userId + ':' +
      (scope.intel_profile_id || scope.project_id || 'none');
    try { if (localStorage.getItem(flag)) return { migrated: false, reason: 'already done' }; } catch { /* ignore */ }

    const local = cacheRead();
    if (!local.length) {
      try { localStorage.setItem(flag, new Date().toISOString()); } catch { /* ignore */ }
      return { migrated: false, reason: 'nothing local' };
    }
    const remote = await fetchAll();
    if (remote === null) return { migrated: false, reason: 'cloud unreachable' };
    if (remote.length) {
      try { localStorage.setItem(flag, new Date().toISOString()); } catch { /* ignore */ }
      return { migrated: false, reason: 'cloud already has records' };
    }
    const ok = await save(local);
    if (!ok) return { migrated: false, reason: 'write failed' };
    try { localStorage.setItem(flag, new Date().toISOString()); } catch { /* ignore */ }
    return { migrated: true, count: local.length };
  }

  /**
   * Refresh the cache from the account.
   * @returns {Promise<{synced: boolean, reason?: string}>}
   */
  async function syncFromCloud() {
    const userId = await getUserId();
    if (!userId) {
      setSyncState(false, null);
      return { synced: false, reason: 'Sign in to share this backlog with your team.' };
    }
    await migrateLocal();
    const rows = await fetchAll();
    if (rows === null) {
      setSyncState(false, 'Could not reach your account.');
      return { synced: false, reason: 'Could not reach your account.' };
    }
    cacheWrite(rows.map(fromRow));
    setSyncState(true, null);
    return { synced: true };
  }

  function getSyncState() { return { synced }; }
  function setOnSyncChange(fn) { onSyncChange = fn; }

  return { list, save, syncFromCloud, migrateLocal, getSyncState, setOnSyncChange, getScope };
})();
