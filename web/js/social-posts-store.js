/**
 * SocialPostsStore — per-post storage for Social Studio (PULSE)
 *
 * Replaces the old "one markdown blob per generation" model. Every
 * organic post or ad concept Claude generates becomes its own row via
 * createBatch(), with its own review status (pending_review / approved /
 * rejected), optional scheduled_at, optional rendered image, and a
 * publish_status a real platform-publish adapter can update later.
 *
 * Scope: same dual project/profile model as BusinessBrainCloud — an active
 * intelligence profile takes priority, falling back to the legacy
 * per-project scope. See supabase-social-posts.sql for the schema.
 */
window.SocialPostsStore = (function () {
  'use strict';

  function getSupabase() {
    return window.Supabase?.getClient?.() || null;
  }

  async function getUserId() {
    const client = getSupabase();
    if (!client) return null;

    // auth.getUser() re-verifies the JWT against Supabase's auth server on
    // every call — unlike getSession() (what the rest of the app uses to
    // show "you're logged in"), which just reads the cached token locally.
    // A transient network blip or a brief token-refresh window makes
    // getUser() fail even when the session is genuinely valid, which reads
    // exactly like "the app shows me logged in, but this feature asks me to
    // sign in." Fall back to the session's own user in that case — it's
    // safe: if the session were actually invalid, the write below still
    // gets rejected server-side by RLS (Postgres checks the real JWT, not
    // this client-supplied id), so this can't grant access on a stale or
    // forged session, only avoid a false "not signed in".
    try {
      const { data: { user }, error } = await client.auth.getUser();
      if (user) return user.id;
      if (error) throw error;
    } catch (err) {
      console.warn('[SocialPostsStore] auth.getUser() failed, falling back to cached session:', err.message);
    }

    try {
      const { data: { session } } = await client.auth.getSession();
      return session?.user?.id || null;
    } catch { return null; }
  }

  /** Same scope resolution as BusinessBrainCloud.getScope(). */
  function getScope() {
    const profileId = localStorage.getItem('intel_active_profile');
    if (profileId) return { intel_profile_id: profileId };
    const projectId = localStorage.getItem('seo-current-project');
    if (projectId) return { project_id: projectId };
    return null;
  }

  function genBatchId() {
    return (crypto.randomUUID ? crypto.randomUUID() : `batch_${Date.now()}_${Math.random().toString(36).slice(2)}`);
  }

  /**
   * Insert a batch of generated posts/concepts as pending_review rows.
   * @param {Array<Object>} posts - each: {source, platform, angleType?, hook?, headline, body, cta?, hashtags?, proofPoint?, urgencyLine?, visualDirection?, imageUrl?, metadata?}
   * @returns {Promise<{batchId: string, posts: Array}>}
   */
  async function createBatch(posts) {
    const client = getSupabase();
    const userId = await getUserId();
    if (!client || !userId) throw new Error('Sign in to save generated posts.');
    if (!posts || !posts.length) throw new Error('No posts to save.');

    const scope = getScope() || {};
    const batchId = genBatchId();

    const rows = posts.map((p) => ({
      user_id: userId,
      project_id: scope.project_id || null,
      intel_profile_id: scope.intel_profile_id || null,
      batch_id: batchId,
      source: p.source || 'organic',
      platform: p.platform,
      angle_type: p.angleType || null,
      hook: p.hook || null,
      headline: p.headline,
      body: p.body || '',
      cta: p.cta || null,
      hashtags: p.hashtags || [],
      proof_point: p.proofPoint || null,
      urgency_line: p.urgencyLine || null,
      visual_direction: p.visualDirection || null,
      image_url: p.imageUrl || null,
      metadata: p.metadata || {},
    }));

    const { data, error } = await client.from('social_posts').insert(rows).select();
    if (error) throw new Error(error.message);
    return { batchId, posts: data };
  }

  /** List posts for the active scope, optionally filtered by status/source/batch. */
  async function listPosts({ status, source, batchId, limit = 100 } = {}) {
    const client = getSupabase();
    const scope = getScope();
    if (!client || !scope) return [];

    let q = client.from('social_posts').select('*');
    q = scope.intel_profile_id ? q.eq('intel_profile_id', scope.intel_profile_id) : q.eq('project_id', scope.project_id);
    if (status) q = q.eq('status', status);
    if (source) q = q.eq('source', source);
    if (batchId) q = q.eq('batch_id', batchId);
    q = q.order('created_at', { ascending: false }).limit(limit);

    const { data, error } = await q;
    if (error) { console.warn('[SocialPostsStore] listPosts failed:', error.message); return []; }
    return data || [];
  }

  /** Posts scheduled within a date range, for calendar rendering. */
  async function listCalendar(startIso, endIso) {
    const client = getSupabase();
    const scope = getScope();
    if (!client || !scope) return [];

    let q = client.from('social_posts').select('*').not('scheduled_at', 'is', null)
      .gte('scheduled_at', startIso).lte('scheduled_at', endIso);
    q = scope.intel_profile_id ? q.eq('intel_profile_id', scope.intel_profile_id) : q.eq('project_id', scope.project_id);

    const { data, error } = await q.order('scheduled_at', { ascending: true });
    if (error) { console.warn('[SocialPostsStore] listCalendar failed:', error.message); return []; }
    return data || [];
  }

  async function updateStatus(postId, status, reviewNote) {
    const client = getSupabase();
    if (!client) throw new Error('Cloud unavailable');
    const patch = { status };
    if (reviewNote !== undefined) patch.review_note = reviewNote;
    const { data, error } = await client.from('social_posts').update(patch).eq('id', postId).select().single();
    if (error) throw new Error(error.message);
    return data;
  }

  async function schedulePost(postId, scheduledAtIso) {
    const client = getSupabase();
    if (!client) throw new Error('Cloud unavailable');
    const { data, error } = await client.from('social_posts')
      .update({ status: 'scheduled', scheduled_at: scheduledAtIso, publish_status: 'queued' })
      .eq('id', postId).select().single();
    if (error) throw new Error(error.message);
    return data;
  }

  async function updatePost(postId, fields) {
    const client = getSupabase();
    if (!client) throw new Error('Cloud unavailable');
    const { data, error } = await client.from('social_posts').update(fields).eq('id', postId).select().single();
    if (error) throw new Error(error.message);
    return data;
  }

  async function deletePost(postId) {
    const client = getSupabase();
    if (!client) throw new Error('Cloud unavailable');
    const { error } = await client.from('social_posts').delete().eq('id', postId);
    if (error) throw new Error(error.message);
  }

  return {
    getScope,
    createBatch,
    listPosts,
    listCalendar,
    updateStatus,
    schedulePost,
    updatePost,
    deletePost,
  };
})();
