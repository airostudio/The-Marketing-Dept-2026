/**
 * BrandKitStore — the account's shared visual "staples" (logo, colors, fonts)
 *
 * The one thing every ad/creative generation surface should agree on and
 * currently doesn't: two ads for the same business could come back with
 * different colors and no logo at all, because there was nowhere for the
 * account's own logo/palette/fonts to live once, get uploaded once, and be
 * pulled into every generation call. See supabase-brand-kit.sql's header for
 * the full reasoning, including why this is a NEW table rather than reusing
 * nancy_brands (a different concept — Nancy's per-website research record).
 *
 * Scope: same dual project/profile model as SocialPostsStore/
 * BusinessBrainCloud — an active intelligence profile takes priority,
 * falling back to the legacy per-project scope.
 *
 * Logo upload goes through /api/brand-kit-upload-logo.js (needs the R2
 * service credentials, so it can't happen client-side); everything else
 * (colours, fonts) is a direct, RLS-protected read/write, the same pattern
 * SocialPostsStore already uses for non-file fields.
 */
window.BrandKitStore = (function () {
  'use strict';

  async function getSupabase() {
    if (window.Supabase?.ready) { try { await window.Supabase.ready(); } catch { /* fall through to getClient() below */ } }
    return window.Supabase?.getClient?.() || null;
  }

  // A project created while offline/signed-out gets a locally generated id
  // ('local_<ts>_<rand>') — not a database row, so using it as a scope sends
  // a non-UUID into a uuid foreign-key column. Treat it as no scope at all.
  function isCloudId(id) { return !!id && !String(id).startsWith('local_'); }

  function getScope() {
    const profileId = localStorage.getItem('intel_active_profile');
    if (isCloudId(profileId)) return { intel_profile_id: profileId, key: 'intel_profile_id', id: profileId };
    const projectId = localStorage.getItem('seo-current-project');
    if (isCloudId(projectId)) return { project_id: projectId, key: 'project_id', id: projectId };
    return null;
  }

  const EMPTY_KIT = { logo_url: null, website_url: null, colours: {}, fonts: {} };

  /** Reads the current scope's brand kit, or EMPTY_KIT if none exists yet or there is no scope. */
  async function getBrandKit() {
    const scope = getScope();
    if (!scope) return { ...EMPTY_KIT, scoped: false };
    const client = await getSupabase();
    if (!client) return { ...EMPTY_KIT, scoped: true, error: 'Cloud unavailable' };

    const { data, error } = await client.from('brand_kits')
      .select('*').eq(scope.key, scope.id).limit(1).maybeSingle();
    if (error) return { ...EMPTY_KIT, scoped: true, error: error.message };
    if (!data) return { ...EMPTY_KIT, scoped: true };
    return { logo_url: data.logo_url, website_url: data.website_url || null, colours: data.colours || {}, fonts: data.fonts || {}, scoped: true, id: data.id };
  }

  /**
   * Upserts colours/fonts/website_url, plus an already-hosted logo_url when
   * the caller has one to confirm (e.g. a reviewed auto-detect result that
   * was already re-hosted to R2 server-side) — a fresh file upload still has
   * to go through uploadLogo(), since only the server holds R2 credentials.
   * A data: URI is refused here on purpose: that means the caller skipped
   * the actual upload step, not that this is a shortcut for it.
   * Creates the row if this scope has none yet.
   * @param {{colours?: object, fonts?: object, website_url?: string, logo_url?: string}} fields
   */
  async function saveBrandKit(fields) {
    const scope = getScope();
    if (!scope) throw new Error('No active business selected — pick one first.');
    const client = await getSupabase();
    if (!client) throw new Error('Cloud unavailable');

    const { data: { user } } = await client.auth.getUser().catch(() => ({ data: {} }));

    const patch = {};
    if (fields.colours !== undefined) patch.colours = fields.colours;
    if (fields.fonts !== undefined) patch.fonts = fields.fonts;
    if (fields.website_url !== undefined) patch.website_url = fields.website_url;
    if (fields.logo_url !== undefined) {
      if (/^data:/i.test(fields.logo_url)) throw new Error('A logo file must go through uploadLogo(), not saveBrandKit().');
      patch.logo_url = fields.logo_url;
    }
    if (user?.id) patch.updated_by = user.id;

    const { data: existing } = await client.from('brand_kits').select('id').eq(scope.key, scope.id).limit(1).maybeSingle();
    if (existing) {
      const { data, error } = await client.from('brand_kits').update(patch).eq('id', existing.id).select().single();
      if (error) throw new Error(error.message);
      return data;
    }
    const { data, error } = await client.from('brand_kits').insert({ [scope.key]: scope.id, ...patch }).select().single();
    if (error) throw new Error(error.message);
    return data;
  }

  /**
   * Uploads a logo file via the server (R2 needs its own credentials, so
   * this can't be a direct client write like colours/fonts above).
   * @param {string} dataUri base64 data: URI
   * @param {string} [fileName]
   * @returns {Promise<string>} the hosted logo URL
   */
  async function uploadLogo(dataUri, fileName) {
    const scope = getScope();
    if (!scope) throw new Error('No active business selected — pick one first.');
    const headers = await (window.sendAuthHeaders ? window.sendAuthHeaders() : { 'Content-Type': 'application/json' });
    const body = { dataUri, fileName };
    if (scope.key === 'intel_profile_id') body.intelProfileId = scope.id;
    else body.projectId = scope.id;

    const res = await fetch('/api/brand-kit-upload-logo', { method: 'POST', headers, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data.logoUrl;
  }

  /**
   * Asks the server to crawl `url` and propose a logo/colours/fonts for
   * review — nothing is saved here. The caller (the Brand Kit UI) applies
   * the result to the form fields and the user still has to click Save.
   * @param {string} url
   * @returns {Promise<{logoUrl, logoSource, websiteUrl, colours, fonts, warnings}>}
   */
  async function autoDetect(url) {
    const scope = getScope();
    if (!scope) throw new Error('No active business selected — pick one first.');
    const headers = await (window.sendAuthHeaders ? window.sendAuthHeaders() : { 'Content-Type': 'application/json' });
    const body = { url };
    if (scope.key === 'intel_profile_id') body.intelProfileId = scope.id;
    else body.projectId = scope.id;

    const res = await fetch('/api/brand-kit-auto-detect', { method: 'POST', headers, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data.detected;
  }

  return { getBrandKit, saveBrandKit, uploadLogo, autoDetect, getScope };
})();
