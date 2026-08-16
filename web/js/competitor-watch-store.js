/**
 * CompetitorWatchStore — client for the scheduled competitor monitoring
 * feature (supabase-competitor-watch.sql, api/cron-competitor-watch.js).
 *
 * Separate from IntelligenceEngine.radar (the existing, purely localStorage
 * "competitors I'm tracking mentally" list Scout already used) — this is
 * the opt-in, server-checked, "alert me when this actually changes" list.
 * Same client-side-Supabase-calls-secured-by-RLS pattern as ContactsStore /
 * ExperimentsStore.
 */
window.CompetitorWatchStore = (function () {
  'use strict';

  function getSupabase() {
    return window.Supabase?.getClient?.() || null;
  }

  async function getUserId() {
    const client = getSupabase();
    if (!client) return null;
    try {
      const { data: { user } } = await client.auth.getUser();
      return user?.id || null;
    } catch { return null; }
  }

  async function addWatch({ name, url }) {
    const client = getSupabase();
    const userId = await getUserId();
    if (!client || !userId) throw new Error('Sign in to monitor a competitor.');
    if (!url) throw new Error('A URL is required.');
    let normalizedUrl = url.trim();
    if (!/^https?:\/\//i.test(normalizedUrl)) normalizedUrl = 'https://' + normalizedUrl;

    const { data, error } = await client
      .from('competitor_watches')
      .upsert({ user_id: userId, name: name || normalizedUrl, url: normalizedUrl, active: true }, { onConflict: 'user_id,url' })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  async function listWatches() {
    const client = getSupabase();
    const userId = await getUserId();
    if (!client || !userId) return [];
    const { data, error } = await client
      .from('competitor_watches')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return data || [];
  }

  async function removeWatch(id) {
    const client = getSupabase();
    if (!client) throw new Error('Not connected.');
    const { error } = await client.from('competitor_watches').delete().eq('id', id);
    if (error) throw new Error(error.message);
  }

  async function setActive(id, active) {
    const client = getSupabase();
    if (!client) throw new Error('Not connected.');
    const { error } = await client.from('competitor_watches').update({ active }).eq('id', id);
    if (error) throw new Error(error.message);
  }

  /** Latest snapshot per watch, keyed by watch_id. */
  async function getLatestSnapshots(watchIds) {
    const client = getSupabase();
    if (!client || !watchIds || !watchIds.length) return {};
    const { data, error } = await client
      .from('competitor_snapshots')
      .select('*')
      .in('watch_id', watchIds)
      .order('fetched_at', { ascending: false });
    if (error) throw new Error(error.message);
    const byWatch = {};
    (data || []).forEach(s => { if (!byWatch[s.watch_id]) byWatch[s.watch_id] = s; });
    return byWatch;
  }

  /** Recent detected changes across all of this user's watches, newest first. */
  async function getRecentChanges(limit = 20) {
    const client = getSupabase();
    const userId = await getUserId();
    if (!client || !userId) return [];
    const { data, error } = await client
      .from('competitor_changes')
      .select('*, competitor_watches!inner(name, url, user_id)')
      .eq('competitor_watches.user_id', userId)
      .order('detected_at', { ascending: false })
      .limit(limit);
    if (error) throw new Error(error.message);
    return data || [];
  }

  return { addWatch, listWatches, removeWatch, setActive, getLatestSnapshots, getRecentChanges };
})();
