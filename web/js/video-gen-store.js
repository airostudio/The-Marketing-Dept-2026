/**
 * VideoGenStore — gallery of AI-generated videos for Reel (Video Studio).
 *
 * This used to be localStorage only, on the reasoning that generated clips are
 * "transient creative drafts". They are not: the page feeds them into
 * SocialPostsStore as scheduled posts, and — more pointedly — while Seedance
 * renders, the provider's task id lives in this record and nowhere else. Lose
 * the record and a render the customer has already paid for becomes
 * unreachable: there is no way to ask "is it done yet" without the task id.
 *
 * Now backed by the video_generations table (see supabase-video-gallery.sql),
 * with localStorage kept as a write-through cache so the existing synchronous
 * call sites and the render path are unchanged.
 *
 * Reads are synchronous and served from the cache. `syncFromCloud()` refreshes
 * that cache and is awaited on page load; writes update the cache first, then
 * the cloud. A write that cannot reach the cloud is surfaced through
 * `onSyncChange`, never swallowed — a save the customer believes happened and
 * did not is the problem this replaces.
 */
window.VideoGenStore = (function () {
  'use strict';

  const KEY = 'reel_videos_v1';
  const MIGRATED_FLAG = 'reel_videos_migrated_v1';

  let synced = false;
  let lastError = null;
  let onSyncChange = null;

  /* ── local cache ─────────────────────────────────────────────────────── */

  function load() {
    try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
  }

  function save(items) {
    try { localStorage.setItem(KEY, JSON.stringify(items)); } catch { /* quota or private mode */ }
  }

  function genId() {
    return crypto.randomUUID ? crypto.randomUUID() : `vid_${Date.now()}_${Math.random().toString(36).slice(2)}`;
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
      console.warn('[VideoGenStore] auth.getUser() failed, trying cached session:', err.message);
    }
    try {
      const { data: { session } } = await client.auth.getSession();
      return session?.user?.id || null;
    } catch { return null; }
  }

  // A project created offline gets a locally generated id ('local_…'), which is
  // not a database row — using it as a scope sends a non-UUID into a uuid
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

  /** The page's record shape ⟷ the table's columns. */
  function toRow(item, userId, scope) {
    return {
      user_id: userId,
      project_id: scope.project_id || null,
      intel_profile_id: scope.intel_profile_id || null,
      client_id: item.id,
      prompt: item.prompt || '',
      mode: item.mode || 'text-to-video',
      image_url: item.imageUrl || null,
      aspect_ratio: item.aspectRatio || '16:9',
      duration: item.duration || 5,
      resolution: item.resolution || '1080p',
      task_id: item.taskId || null,
      status: item.status || 'pending',
      video_url: item.videoUrl || null,
      thumbnail_url: item.thumbnailUrl || null,
      storage: item.storage === 'permanent' ? 'permanent' : 'temporary',
      storage_note: item.storageNote || null,
      error: item.error || null,
      stopped_watching_at: item.stoppedWatchingAt || null,
    };
  }

  function fromRow(row) {
    return {
      id: row.client_id,
      prompt: row.prompt || '',
      mode: row.mode,
      imageUrl: row.image_url,
      aspectRatio: row.aspect_ratio,
      duration: row.duration,
      resolution: row.resolution,
      taskId: row.task_id,
      status: row.status,
      videoUrl: row.video_url,
      thumbnailUrl: row.thumbnail_url,
      storage: row.storage,
      storageNote: row.storage_note,
      error: row.error,
      stoppedWatchingAt: row.stopped_watching_at,
      createdAt: row.created_at,
    };
  }

  function setSyncState(ok, err) {
    synced = ok;
    lastError = err || null;
    if (typeof onSyncChange === 'function') {
      try { onSyncChange({ synced, error: lastError }); } catch { /* a UI callback must not break a save */ }
    }
  }

  async function pushRecord(item) {
    const client = await getSupabase();
    const userId = await getUserId();
    if (!client || !userId) { setSyncState(false, null); return false; }
    const { error } = await client.from('video_generations')
      .upsert(toRow(item, userId, getScope()), { onConflict: 'user_id,client_id' });
    if (error) { setSyncState(false, error.message); return false; }
    setSyncState(true, null);
    return true;
  }

  async function deleteRecord(clientId) {
    const client = await getSupabase();
    const userId = await getUserId();
    if (!client || !userId) return false;
    const { error } = await client.from('video_generations')
      .delete().eq('user_id', userId).eq('client_id', clientId);
    if (error) { setSyncState(false, error.message); return false; }
    return true;
  }

  /* ── public API — reads stay synchronous ─────────────────────────────── */

  /**
   * @param {Object} entry - {prompt, mode, imageUrl?, aspectRatio, duration, resolution, taskId}
   * @returns {Object} the created record, status='pending'
   */
  function create(entry) {
    const items = load();
    const record = {
      id: genId(),
      prompt: entry.prompt || '',
      mode: entry.mode || 'text-to-video',
      imageUrl: entry.imageUrl || null,
      aspectRatio: entry.aspectRatio || '16:9',
      duration: entry.duration || 5,
      resolution: entry.resolution || '1080p',
      taskId: entry.taskId || null,
      status: 'pending',
      videoUrl: null,
      thumbnailUrl: null,
      storage: 'temporary',
      storageNote: null,
      error: null,
      createdAt: new Date().toISOString(),
    };
    items.unshift(record);
    save(items);
    pushRecord(record);
    return record;
  }

  function update(id, patch) {
    const items = load();
    const idx = items.findIndex(i => i.id === id);
    if (idx === -1) return null;
    items[idx] = { ...items[idx], ...patch };
    save(items);
    pushRecord(items[idx]);
    return items[idx];
  }

  function remove(id) {
    save(load().filter(i => i.id !== id));
    deleteRecord(id);
  }

  function list() { return load(); }

  function getById(id) { return load().find(i => i.id === id) || null; }

  /* ── sync ────────────────────────────────────────────────────────────── */

  /**
   * Lift anything already in this browser into the account, once.
   * Only runs when the cloud holds nothing for this scope, so a local copy
   * can never overwrite a gallery built on another device.
   */
  async function migrateLocal() {
    const userId = await getUserId();
    if (!userId) return { migrated: false, reason: 'not signed in' };
    const scope = getScope();
    const flag = MIGRATED_FLAG + ':' + userId + ':' +
      (scope.intel_profile_id || scope.project_id || 'none');
    try { if (localStorage.getItem(flag)) return { migrated: false, reason: 'already done' }; } catch { /* ignore */ }

    const local = load();
    if (!local.length) {
      try { localStorage.setItem(flag, new Date().toISOString()); } catch { /* ignore */ }
      return { migrated: false, reason: 'nothing local' };
    }

    const client = await getSupabase();
    if (!client) return { migrated: false, reason: 'cloud unreachable' };
    let q = client.from('video_generations').select('client_id').eq('user_id', userId).limit(1);
    q = scopeFilter(q, scope);
    const { data, error } = await q;
    if (error) return { migrated: false, reason: error.message };
    if (data && data.length) {
      try { localStorage.setItem(flag, new Date().toISOString()); } catch { /* ignore */ }
      return { migrated: false, reason: 'cloud already has records' };
    }

    const rows = local.map(item => toRow(item, userId, scope));
    const { error: upErr } = await client.from('video_generations')
      .upsert(rows, { onConflict: 'user_id,client_id' });
    if (upErr) return { migrated: false, reason: upErr.message };
    try { localStorage.setItem(flag, new Date().toISOString()); } catch { /* ignore */ }
    return { migrated: true, count: rows.length };
  }

  /**
   * Refresh the cache from the account. Returns { synced, reason }.
   * A read that could not reach the cloud is reported as such rather than
   * being mistaken for an empty gallery.
   */
  async function syncFromCloud() {
    const client = await getSupabase();
    const userId = await getUserId();
    if (!client || !userId) {
      setSyncState(false, null);
      return { synced: false, reason: 'Sign in to keep your videos across devices.' };
    }
    try {
      await migrateLocal();
      let q = client.from('video_generations').select('*').eq('user_id', userId);
      q = scopeFilter(q, getScope());
      const { data, error } = await q.order('created_at', { ascending: false });
      if (error) {
        setSyncState(false, error.message);
        return { synced: false, reason: error.message };
      }
      save((data || []).map(fromRow));
      setSyncState(true, null);
      return { synced: true };
    } catch (err) {
      setSyncState(false, err.message);
      return { synced: false, reason: err.message };
    }
  }

  function getSyncState() { return { synced, error: lastError }; }
  function setOnSyncChange(fn) { onSyncChange = fn; }

  return {
    create, update, remove, list, getById,
    syncFromCloud, migrateLocal, getSyncState, setOnSyncChange, getScope,
  };
})();
