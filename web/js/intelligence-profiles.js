/**
 * IntelligenceProfiles — multi-business Intelligence Layer profiles
 *
 * One profile = one business's complete intelligence context. Users switch
 * the active profile to work on different businesses; the Business Brain
 * (and its cloud sync/history) is scoped to the active profile.
 *
 * Plan limits (enforced server-side by a Postgres trigger, mirrored here
 * for friendly UX): basic/free = 1, professional/pro = 3, agency = 8,
 * enterprise = admin-configured via profiles.intel_profile_limit.
 *
 * Active profile is stored in localStorage ('intel_active_profile') and a
 * 'intel-profile:changed' event fires on switch so open pages can reload.
 *
 * Requires: supabase-client.js (window.Supabase), tables from
 * supabase-intelligence-profiles.sql.
 */
window.IntelligenceProfiles = (function () {
  'use strict';

  const ACTIVE_KEY = 'intel_active_profile';
  const PLAN_LIMITS = { free: 1, basic: 1, pro: 3, professional: 3, agency: 8 };

  function getSupabase() {
    return window.Supabase?.getClient?.() || null;
  }

  // auth.getUser() re-verifies the JWT against Supabase's auth server on
  // every call, unlike getSession() (a local cache read) — a transient
  // network blip or a brief post-login token-refresh window makes
  // getUser() fail even when the session is genuinely valid. Without a
  // fallback, ensureActiveProfile() below sees "signed out", bails, and no
  // profile gets activated — which is exactly what "I logged back in and
  // my Business Brain disappeared" looks like from the outside, even
  // though the data was never touched. Same fix already applied to
  // NancyStore/SocialPostsStore after finding this bug there.
  async function getUserId() {
    const client = getSupabase();
    if (!client) return null;
    try {
      const { data: { user }, error } = await client.auth.getUser();
      if (user) return user.id;
      if (error) throw error;
    } catch (err) {
      console.warn('[IntelligenceProfiles] auth.getUser() failed, falling back to cached session:', err.message);
    }
    try {
      const { data: { session } } = await client.auth.getSession();
      return session?.user?.id || null;
    } catch { return null; }
  }

  /** { plan, limit, used } for the signed-in account. */
  async function getPlanInfo() {
    const client = getSupabase();
    const userId = await getUserId();
    if (!client || !userId) return { plan: 'basic', limit: 1, used: 0, offline: true };

    let plan = 'basic', customLimit = null;
    try {
      const { data } = await client.from('profiles')
        .select('plan, intel_profile_limit').eq('id', userId).maybeSingle();
      if (data) { plan = data.plan || 'basic'; customLimit = data.intel_profile_limit; }
    } catch { /* keep defaults */ }

    const limit = plan === 'enterprise'
      ? (customLimit || 1)
      : (PLAN_LIMITS[plan] || 1);

    let used = 0;
    try {
      const { count } = await client.from('intelligence_profiles')
        .select('id', { count: 'exact', head: true }).eq('owner_id', userId);
      used = count || 0;
    } catch { /* leave 0 */ }

    return { plan, limit, used };
  }

  /** All profiles the user owns or is a member of, newest first. */
  async function list() {
    const client = getSupabase();
    if (!client) return [];
    try {
      const { data, error } = await client.from('intelligence_profiles')
        .select('id, owner_id, name, business_name, notes, created_at, updated_at')
        .order('created_at', { ascending: true });
      if (error) return [];
      return data || [];
    } catch { return []; }
  }

  async function create(name, businessName) {
    const client = getSupabase();
    const userId = await getUserId();
    if (!client || !userId) throw new Error('Sign in to create intelligence profiles.');
    if (!name || !name.trim()) throw new Error('Profile name is required.');

    const info = await getPlanInfo();
    if (info.used >= info.limit) {
      throw new Error(`Profile limit reached (${info.used} of ${info.limit} on the ${info.plan} plan). Upgrade to add more.`);
    }

    const { data, error } = await client.from('intelligence_profiles')
      .insert({ owner_id: userId, name: name.trim(), business_name: (businessName || '').trim() })
      .select().single();
    if (error) throw new Error(error.message);
    return data;
  }

  async function rename(profileId, name) {
    const client = getSupabase();
    if (!client) throw new Error('Cloud unavailable');
    const { error } = await client.from('intelligence_profiles')
      .update({ name: name.trim() }).eq('id', profileId);
    if (error) throw new Error(error.message);
  }

  async function remove(profileId) {
    const client = getSupabase();
    if (!client) throw new Error('Cloud unavailable');
    const { error } = await client.from('intelligence_profiles').delete().eq('id', profileId);
    if (error) throw new Error(error.message);
    if (getActiveProfileId() === profileId) clearActiveProfile();
  }

  function getActiveProfileId() {
    return localStorage.getItem(ACTIVE_KEY) || null;
  }

  function setActiveProfile(profileId) {
    localStorage.setItem(ACTIVE_KEY, profileId);
    try {
      document.dispatchEvent(new CustomEvent('intel-profile:changed', { detail: { profileId } }));
    } catch (_) {}
  }

  function clearActiveProfile() {
    localStorage.removeItem(ACTIVE_KEY);
  }

  /**
   * Ensure the account has at least one profile and an active selection.
   * If none exist, creates "Default" and returns it. If profiles exist but
   * none is active (fresh login/device), activates the first — pages should
   * offer the picker when more than one exists.
   * Returns { profiles, active, created } or null when offline/signed out.
   */
  async function ensureActiveProfile() {
    const userId = await getUserId();
    if (!userId) return null;

    let profiles = await list();
    let created = false;

    if (!profiles.length) {
      try {
        const p = await create('Default');
        profiles = [p];
        created = true;
      } catch { return null; }
    }

    let activeId = getActiveProfileId();
    if (!activeId || !profiles.some(p => p.id === activeId)) {
      activeId = profiles[0].id;
      setActiveProfile(activeId);
    }

    return { profiles, active: profiles.find(p => p.id === activeId), created };
  }

  return {
    getPlanInfo,
    list,
    create,
    rename,
    remove,
    getActiveProfileId,
    setActiveProfile,
    clearActiveProfile,
    ensureActiveProfile,
    ACTIVE_KEY,
  };
})();
