/**
 * LinkReportsStore — the shared repository behind web/tools/link-funnel.html.
 *
 * Every agent page can load this file the same way they already load
 * ContactsStore/SocialPostsStore — it isn't tool-page-private state. The
 * point of building it as its own store, rather than keeping results in the
 * tool page's own memory, is that "drop a spreadsheet of URLs" is something
 * any agent's workflow might eventually want to hand off to or read from
 * (Blade re-checking a saved list, SEO auditing the good URLs, Pat funneling
 * the reachable ones into a campaign) without re-uploading the same file.
 *
 * Same dual project/profile scope as ContactsStore — see supabase-link-
 * reports.sql for the schema and RLS.
 */
window.LinkReportsStore = (function () {
  'use strict';

  async function getSupabase() {
    if (window.Supabase?.ready) { try { await window.Supabase.ready(); } catch { /* fall through to getClient() below */ } }
    return window.Supabase?.getClient?.() || null;
  }

  async function getUserId() {
    const client = await getSupabase();
    if (!client) return null;
    try {
      const { data: { user } } = await client.auth.getUser();
      return user?.id || null;
    } catch { return null; }
  }

  // Same scope resolution as ContactsStore.getScope() — a locally generated
  // id (created while offline/signed-out) is not a database row, so treating
  // it as a scope would send a non-UUID into a uuid foreign-key column.
  function isCloudId(id) { return !!id && !String(id).startsWith('local_'); }

  function getScope() {
    const profileId = localStorage.getItem('intel_active_profile');
    if (isCloudId(profileId)) return { intel_profile_id: profileId };
    const projectId = localStorage.getItem('seo-current-project');
    if (isCloudId(projectId)) return { project_id: projectId };
    return null;
  }

  /**
   * @param {object} report
   * @param {string} report.name
   * @param {string} [report.sourceFilename]
   * @param {Array<{url,status,reasons,checkedAt}>} report.results
   * @param {Array<{text,reason}>} report.rejected
   */
  async function saveReport(report) {
    const client = await getSupabase();
    const userId = await getUserId();
    if (!client || !userId) throw new Error('Sign in to save a link report.');
    if (!report || !report.name) throw new Error('A report needs a name.');

    const scope = getScope() || {};
    const row = {
      user_id: userId,
      project_id: scope.project_id || null,
      intel_profile_id: scope.intel_profile_id || null,
      name: report.name,
      source_filename: report.sourceFilename || null,
      results: report.results || [],
      rejected: report.rejected || [],
      good_count: (report.results || []).length,
      bad_count: (report.rejected || []).length,
    };

    const { data, error } = await client.from('link_check_reports').insert(row).select().single();
    if (error) throw new Error(error.message);
    return data;
  }

  /** Every report visible to this account for the current business/project scope, newest first. */
  async function listReports() {
    const client = await getSupabase();
    const userId = await getUserId();
    if (!client || !userId) return [];

    let query = client.from('link_check_reports').select('*').order('created_at', { ascending: false });
    const scope = getScope();
    // Scoped to the active business when one is selected — otherwise fall
    // back to everything this account owns, the same "no business picked
    // yet" behavior ContactsStore's callers already expect.
    if (scope && scope.intel_profile_id) query = query.eq('intel_profile_id', scope.intel_profile_id);
    else if (scope && scope.project_id) query = query.eq('project_id', scope.project_id);
    else query = query.eq('user_id', userId);

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return data || [];
  }

  async function getReport(id) {
    const client = await getSupabase();
    if (!client) return null;
    const { data, error } = await client.from('link_check_reports').select('*').eq('id', id).single();
    if (error) throw new Error(error.message);
    return data;
  }

  async function deleteReport(id) {
    const client = await getSupabase();
    if (!client) throw new Error('Sign in to manage link reports.');
    const { error } = await client.from('link_check_reports').delete().eq('id', id);
    if (error) throw new Error(error.message);
  }

  return { saveReport, listReports, getReport, deleteReport };
})();
