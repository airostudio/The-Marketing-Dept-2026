/**
 * NancyStore — client-side Supabase persistence for Nancy "Jam Fancy"
 * (brands, research runs, content weeks, posts). Matches the
 * SocialPostsStore/ContactsStore pattern used elsewhere in this app.
 */
window.NancyStore = (function () {
  'use strict';

  function getSupabase() { return window.Supabase?.getClient?.() || null; }

  // Same getUser()-with-getSession()-fallback pattern fixed in
  // SocialPostsStore after the "shows logged in but this feature disagrees"
  // bug — auth.getUser() re-verifies against the server and can transiently
  // fail even with a perfectly valid session; falling back to the cached
  // session's user avoids a false negative without weakening security (RLS
  // still checks the real JWT server-side regardless of the id used here).
  async function getUserId() {
    const client = getSupabase();
    if (!client) return null;
    try {
      const { data: { user }, error } = await client.auth.getUser();
      if (user) return user.id;
      if (error) throw error;
    } catch (err) {
      console.warn('[NancyStore] auth.getUser() failed, falling back to cached session:', err.message);
    }
    try {
      const { data: { session } } = await client.auth.getSession();
      return session?.user?.id || null;
    } catch { return null; }
  }

  async function createBrand(brandFields) {
    const client = getSupabase();
    const userId = await getUserId();
    if (!client || !userId) throw new Error('Sign in to save your brand.');
    const { data, error } = await client.from('nancy_brands').insert({ user_id: userId, ...brandFields }).select().single();
    if (error) throw new Error(error.message);
    return data;
  }

  async function updateBrand(brandId, fields) {
    const client = getSupabase();
    if (!client) throw new Error('Cloud unavailable');
    const { data, error } = await client.from('nancy_brands').update(fields).eq('id', brandId).select().single();
    if (error) throw new Error(error.message);
    return data;
  }

  async function listBrands() {
    const client = getSupabase();
    const userId = await getUserId();
    if (!client || !userId) return [];
    const { data, error } = await client.from('nancy_brands').select('*').eq('user_id', userId).order('created_at', { ascending: false });
    if (error) { console.warn('[NancyStore] listBrands failed:', error.message); return []; }
    return data || [];
  }

  async function createResearchRun(brandId, fields) {
    const client = getSupabase();
    if (!client) throw new Error('Cloud unavailable');
    const { data, error } = await client.from('nancy_research_runs').insert({ brand_id: brandId, ...fields }).select().single();
    if (error) throw new Error(error.message);
    return data;
  }

  async function saveCompetitors(researchRunId, competitors) {
    const client = getSupabase();
    if (!client || !competitors?.length) return [];
    const rows = competitors.map(c => ({
      research_run_id: researchRunId, business_name: c.business_name, website: c.website,
      positioning: c.positioning, target_customer: c.target_customer, main_offer: c.main_offer,
      content_topics: c.content_topics || [], tone: c.tone, differentiators: c.differentiators || [],
      notable_patterns: c.notable_patterns || [], source_urls: c.source_urls || [],
    }));
    const { data, error } = await client.from('nancy_competitors').insert(rows).select();
    if (error) { console.warn('[NancyStore] saveCompetitors failed:', error.message); return []; }
    return data || [];
  }

  async function saveSourceDocuments(researchRunId, citations) {
    const client = getSupabase();
    if (!client || !citations?.length) return;
    const rows = citations.map(c => ({ research_run_id: researchRunId, url: c.url || c, title: c.title || null }));
    const { error } = await client.from('nancy_source_documents').insert(rows);
    if (error) console.warn('[NancyStore] saveSourceDocuments failed:', error.message);
  }

  async function createContentWeek(brandId, researchRunId, weekNumber, strategy) {
    const client = getSupabase();
    if (!client) throw new Error('Cloud unavailable');
    const { data, error } = await client.from('nancy_content_weeks')
      .insert({ brand_id: brandId, research_run_id: researchRunId, week_number: weekNumber, strategy, status: 'generating' })
      .select().single();
    if (error) throw new Error(error.message);
    return data;
  }

  async function savePosts(contentWeekId, posts) {
    const client = getSupabase();
    if (!client) throw new Error('Cloud unavailable');
    const rows = posts.map(p => ({
      content_week_id: contentWeekId, day: p.day, objective: p.objective, content_pillar: p.content_pillar,
      format: p.format, hook: p.hook, slide_headline: p.slide_headline, slide_copy: p.slide_copy,
      caption: p.caption, cta: p.cta, visual_direction: p.visual_direction, uses_user_photo: !!p.uses_user_photo,
      research_basis: p.research_basis, hashtags: p.hashtags || [], design_data: p.design_data || {},
      rendered_svg: p.rendered_svg || null, rendered_asset_url: p.rendered_asset_url || null,
    }));
    const { data, error } = await client.from('nancy_posts').upsert(rows, { onConflict: 'content_week_id,day' }).select();
    if (error) throw new Error(error.message);
    return data;
  }

  async function updatePost(postId, fields) {
    const client = getSupabase();
    if (!client) throw new Error('Cloud unavailable');
    const { data, error } = await client.from('nancy_posts').update(fields).eq('id', postId).select().single();
    if (error) throw new Error(error.message);
    return data;
  }

  async function setWeekStatus(contentWeekId, status, error) {
    const client = getSupabase();
    if (!client) return;
    await client.from('nancy_content_weeks').update({ status, error: error || null }).eq('id', contentWeekId);
  }

  async function listContentWeeks(brandId) {
    const client = getSupabase();
    if (!client) return [];
    const { data, error } = await client.from('nancy_content_weeks').select('*, nancy_posts(*)').eq('brand_id', brandId).order('week_number', { ascending: false });
    if (error) { console.warn('[NancyStore] listContentWeeks failed:', error.message); return []; }
    return data || [];
  }

  async function savePhotoRecord(userId, brandId, storageUrl, metadata) {
    const client = getSupabase();
    if (!client) return null;
    const { data, error } = await client.from('nancy_user_photos').insert({ user_id: userId, brand_id: brandId, storage_url: storageUrl, metadata }).select().single();
    if (error) { console.warn('[NancyStore] savePhotoRecord failed:', error.message); return null; }
    return data;
  }

  return {
    getUserId, createBrand, updateBrand, listBrands,
    createResearchRun, saveCompetitors, saveSourceDocuments,
    createContentWeek, savePosts, updatePost, setWeekStatus, listContentWeeks,
    savePhotoRecord,
  };
})();
