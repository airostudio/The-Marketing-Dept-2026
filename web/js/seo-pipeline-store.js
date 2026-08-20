/**
 * SEOPipelineStore — cloud persistence for the SEO agent's competitor
 * analysis, daily task plan, topic research, article writer, and backlink
 * prospecting/outreach queue. Same dual project/intel_profile scope model
 * and getUser()-with-getSession()-fallback pattern as every other store
 * this session (NancyStore, ContactsStore, AnalyticsStore).
 * See supabase-seo-pipeline.sql for the schema.
 */
window.SEOPipelineStore = (function () {
  'use strict';

  async function getSupabase() {
    if (window.Supabase?.ready) { try { await window.Supabase.ready(); } catch { /* fall through to getClient() below */ } }
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
      console.warn('[SEOPipelineStore] auth.getUser() failed, falling back to cached session:', err.message);
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

  async function createRun({ websiteUrl, businessSummary, productsServices, targetCustomer, existingTopics, competitors }) {
    const client = await getSupabase();
    const userId = await getUserId();
    if (!client || !userId) throw new Error('Sign in to save this SEO run.');
    const scope = getScope() || {};
    const { data, error } = await client.from('seo_runs').insert({
      user_id: userId, project_id: scope.project_id || null, intel_profile_id: scope.intel_profile_id || null,
      website_url: websiteUrl, business_summary: businessSummary, products_services: productsServices || [],
      target_customer: targetCustomer, existing_topics: existingTopics || [], competitors: competitors || [],
      status: 'ready',
    }).select().single();
    if (error) throw new Error(error.message);
    return data;
  }

  async function listRuns() {
    const client = await getSupabase();
    const userId = await getUserId();
    if (!client || !userId) return [];

    // createRun() happily saves with a null scope (`getScope() || {}`), but
    // this used to return [] outright whenever getScope() was null — so a
    // run saved without an active intelligence profile was written to the
    // database and then became permanently unreachable, taking its topics,
    // articles and backlink prospects with it (they're all found via
    // run_id, which only this function surfaces). Filter by user_id
    // instead, which RLS already enforces, so nothing is ever orphaned.
    let q = client.from('seo_runs').select('*').eq('user_id', userId);

    // With a scope active, still scope the list — but keep unscoped runs
    // visible so work saved before a profile existed doesn't disappear the
    // moment one is created.
    const orFilter = scopeOr(getScope());
    if (orFilter) q = q.or(orFilter);

    const { data, error } = await q.order('created_at', { ascending: false });
    if (error) { console.warn('[SEOPipelineStore] listRuns failed:', error.message); return []; }
    return data || [];
  }

  /** PostgREST `or` filter for a scope, or null when unscoped. */
  function scopeOr(scope) {
    const unscoped = 'and(intel_profile_id.is.null,project_id.is.null)';
    if (scope?.intel_profile_id) return `intel_profile_id.eq.${scope.intel_profile_id},${unscoped}`;
    if (scope?.project_id) return `project_id.eq.${scope.project_id},${unscoped}`;
    return null;
  }

  async function saveTopics(runId, topics) {
    const client = await getSupabase();
    const userId = await getUserId();
    if (!client || !userId) throw new Error('Sign in required.');
    const rows = topics.map(t => ({
      run_id: runId, user_id: userId, topic: t.topic, target_keyword: t.target_keyword,
      search_volume: t.search_volume ?? null, difficulty: t.difficulty ?? null,
      data_source: t.data_source || 'estimate', rationale: t.rationale || null, content_pillar: t.content_pillar || null,
    }));
    const { data, error } = await client.from('seo_topics').insert(rows).select();
    if (error) throw new Error(error.message);
    return data;
  }

  async function listTopics(runId) {
    const client = await getSupabase();
    if (!client) return [];
    const { data, error } = await client.from('seo_topics').select('*').eq('run_id', runId).order('created_at', { ascending: true });
    if (error) { console.warn('[SEOPipelineStore] listTopics failed:', error.message); return []; }
    return data || [];
  }

  async function updateTopicStatus(topicId, status) {
    const client = await getSupabase();
    if (!client) throw new Error('Cloud unavailable');
    const { error } = await client.from('seo_topics').update({ status }).eq('id', topicId);
    if (error) throw new Error(error.message);
  }

  async function saveDailyTasks(runId, tasks) {
    const client = await getSupabase();
    const userId = await getUserId();
    if (!client || !userId) throw new Error('Sign in required.');
    const rows = tasks.map(t => ({
      run_id: runId, user_id: userId, day_number: t.day_number, task_type: t.task_type,
      title: t.title, description: t.description || null, topic_id: t.topic_id || null,
    }));
    const { data, error } = await client.from('seo_daily_tasks').insert(rows).select();
    if (error) throw new Error(error.message);
    return data;
  }

  async function listDailyTasks(runId) {
    const client = await getSupabase();
    if (!client) return [];
    const { data, error } = await client.from('seo_daily_tasks').select('*').eq('run_id', runId).order('day_number', { ascending: true });
    if (error) { console.warn('[SEOPipelineStore] listDailyTasks failed:', error.message); return []; }
    return data || [];
  }

  async function updateTaskStatus(taskId, status) {
    const client = await getSupabase();
    if (!client) throw new Error('Cloud unavailable');
    const { error } = await client.from('seo_daily_tasks').update({ status }).eq('id', taskId);
    if (error) throw new Error(error.message);
  }

  async function saveArticle(runId, topicId, article) {
    const client = await getSupabase();
    const userId = await getUserId();
    if (!client || !userId) throw new Error('Sign in to save this article.');
    const { data, error } = await client.from('seo_articles').insert({
      run_id: runId, user_id: userId, topic_id: topicId || null,
      title: article.title, meta_description: article.meta_description, slug: article.slug,
      target_keyword: article.target_keyword, body_markdown: article.body_markdown,
      schema_markup: article.schema_markup || null, word_count: article.word_count || null,
    }).select().single();
    if (error) throw new Error(error.message);
    return data;
  }

  async function listArticles(runId) {
    const client = await getSupabase();
    if (!client) return [];
    const { data, error } = await client.from('seo_articles').select('id, title, slug, target_keyword, word_count, status, created_at').eq('run_id', runId).order('created_at', { ascending: false });
    if (error) { console.warn('[SEOPipelineStore] listArticles failed:', error.message); return []; }
    return data || [];
  }

  async function getArticle(id) {
    const client = await getSupabase();
    if (!client) return null;
    const { data, error } = await client.from('seo_articles').select('*').eq('id', id).single();
    if (error) { console.warn('[SEOPipelineStore] getArticle failed:', error.message); return null; }
    return data;
  }

  async function updateArticleStatus(id, status) {
    const client = await getSupabase();
    if (!client) throw new Error('Cloud unavailable');
    const { error } = await client.from('seo_articles').update({ status }).eq('id', id);
    if (error) throw new Error(error.message);
  }

  async function saveProspects(runId, prospects) {
    const client = await getSupabase();
    const userId = await getUserId();
    if (!client || !userId) throw new Error('Sign in required.');
    const rows = prospects.map(p => ({
      run_id: runId, user_id: userId, domain: p.domain, page_url: p.page_url || null,
      relevance_reason: p.relevance_reason || null, data_source: p.data_source || 'estimate',
    }));
    const { data, error } = await client.from('seo_backlink_prospects').insert(rows).select();
    if (error) throw new Error(error.message);
    return data;
  }

  async function listProspects(runId) {
    const client = await getSupabase();
    if (!client) return [];
    const { data, error } = await client.from('seo_backlink_prospects').select('*').eq('run_id', runId).order('created_at', { ascending: false });
    if (error) { console.warn('[SEOPipelineStore] listProspects failed:', error.message); return []; }
    return data || [];
  }

  async function updateProspect(id, fields) {
    const client = await getSupabase();
    if (!client) throw new Error('Cloud unavailable');
    const { data, error } = await client.from('seo_backlink_prospects').update(fields).eq('id', id).select().single();
    if (error) throw new Error(error.message);
    return data;
  }

  return {
    getUserId, getScope,
    createRun, listRuns,
    saveTopics, listTopics, updateTopicStatus,
    saveDailyTasks, listDailyTasks, updateTaskStatus,
    saveArticle, listArticles, getArticle, updateArticleStatus,
    saveProspects, listProspects, updateProspect,
  };
})();
