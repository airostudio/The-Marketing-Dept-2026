/**
 * AnalyticsStore — cloud persistence for Analytics Brain's Report Builder
 *
 * Reports used to disappear the moment you navigated away — only a
 * this-device-only localStorage copy existed (agent-history.js). This gives
 * generated reports real, cross-device, versioned storage matching the
 * pattern used elsewhere (NancyStore, SocialPostsStore, ContactsStore).
 * Same dual project/intel_profile scope model as ContactsStore.
 * See supabase-analytics-brain.sql for the schema.
 */
window.AnalyticsStore = (function () {
  'use strict';

  async function getSupabase() {
    if (window.Supabase?.ready) { try { await window.Supabase.ready(); } catch { /* fall through to getClient() below */ } }
    return window.Supabase?.getClient?.() || null;
  }

  // Same getUser()-with-getSession()-fallback pattern applied to every other
  // store this session after finding auth.getUser() can transiently fail
  // right after a fresh login even with a valid session.
  async function getUserId() {
    const client = await getSupabase();
    if (!client) return null;
    try {
      const { data: { user }, error } = await client.auth.getUser();
      if (user) return user.id;
      if (error) throw error;
    } catch (err) {
      console.warn('[AnalyticsStore] auth.getUser() failed, falling back to cached session:', err.message);
    }
    try {
      const { data: { session } } = await client.auth.getSession();
      return session?.user?.id || null;
    } catch { return null; }
  }

  function getScope() {
    const profileId = localStorage.getItem('intel_active_profile');
    if (profileId) return { intel_profile_id: profileId };
    const projectId = localStorage.getItem('seo-current-project');
    if (projectId) return { project_id: projectId };
    return null;
  }

  /**
   * @param {Object} opts
   * @param {string} opts.reportType
   * @param {string} [opts.audience]
   * @param {string} opts.title
   * @param {string} [opts.focus]
   * @param {string} [opts.sourceData]
   * @param {string} opts.content
   */
  async function createReport({ reportType, audience, title, focus, sourceData, content }) {
    const client = await getSupabase();
    const userId = await getUserId();
    if (!client || !userId) throw new Error('Sign in to save reports.');
    if (!content || !content.trim()) throw new Error('No report content to save.');

    const scope = getScope() || {};
    const { data, error } = await client.from('analytics_reports').insert({
      user_id: userId,
      project_id: scope.project_id || null,
      intel_profile_id: scope.intel_profile_id || null,
      report_type: reportType,
      audience: audience || null,
      title: title || `${reportType} report`,
      focus: focus || null,
      source_data: sourceData || null,
      content,
    }).select().single();
    if (error) throw new Error(error.message);
    return data;
  }

  /** Reports for the active scope, newest first. */
  async function listReports(limit = 50) {
    const client = await getSupabase();
    const scope = getScope();
    if (!client || !scope) return [];

    let q = client.from('analytics_reports').select('id, report_type, audience, title, created_at');
    q = scope.intel_profile_id ? q.eq('intel_profile_id', scope.intel_profile_id) : q.eq('project_id', scope.project_id);
    const { data, error } = await q.order('created_at', { ascending: false }).limit(limit);
    if (error) { console.warn('[AnalyticsStore] listReports failed:', error.message); return []; }
    return data || [];
  }

  async function getReport(id) {
    const client = await getSupabase();
    if (!client) return null;
    const { data, error } = await client.from('analytics_reports').select('*').eq('id', id).single();
    if (error) { console.warn('[AnalyticsStore] getReport failed:', error.message); return null; }
    return data;
  }

  async function deleteReport(id) {
    const client = await getSupabase();
    const userId = await getUserId();
    if (!client || !userId) throw new Error('Sign in required.');
    const { error } = await client.from('analytics_reports').delete().eq('id', id).eq('user_id', userId);
    if (error) throw new Error(error.message);
    return true;
  }

  return { getUserId, getScope, createReport, listReports, getReport, deleteReport };
})();
