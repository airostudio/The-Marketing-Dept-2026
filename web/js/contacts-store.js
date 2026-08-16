/**
 * ContactsStore — persistent audience database for Pat (Email Delivery)
 *
 * A reusable contact list + segments, so campaigns pull recipients from a
 * saved audience instead of a fresh paste every time. Mirrors the
 * SocialPostsStore / BusinessBrainCloud pattern: client-side Supabase calls
 * secured by RLS, same dual project/profile scope. See supabase-audience.sql
 * for the schema.
 */
window.ContactsStore = (function () {
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

  /** Same scope resolution as SocialPostsStore.getScope(). */
  function getScope() {
    const profileId = localStorage.getItem('intel_active_profile');
    if (profileId) return { intel_profile_id: profileId };
    const projectId = localStorage.getItem('seo-current-project');
    if (projectId) return { project_id: projectId };
    return null;
  }

  function normEmail(email) {
    return (email || '').trim().toLowerCase();
  }

  /* ─────────────────────────────────────────────────────────────────────────
     CONTACTS
  ───────────────────────────────────────────────────────────────────────── */

  /**
   * Bulk import/upsert contacts by email (per-account unique). Existing
   * contacts get their name/company/custom fields updated and new tags
   * merged in rather than overwritten — importing the same list twice is
   * safe and additive, not destructive.
   * @param {Array<{email, firstName?, lastName?, company?, tags?, customFields?, source?}>} rows
   * @param {Object} [opts]
   * @param {string} [opts.consentSource] - lawful basis applied to every row in this import, e.g. "Website signup form"
   * @returns {Promise<{imported:number, updated:number, skipped:Array}>}
   */
  async function upsertContacts(rows, opts = {}) {
    const client = getSupabase();
    const userId = await getUserId();
    if (!client || !userId) throw new Error('Sign in to save contacts.');
    if (!rows || !rows.length) throw new Error('No contacts to import.');

    const scope = getScope() || {};
    const skipped = [];
    const clean = [];
    const seen = new Set();

    rows.forEach((r) => {
      const email = normEmail(r.email);
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        skipped.push({ email: r.email, reason: 'invalid email' });
        return;
      }
      if (seen.has(email)) return; // dedupe within this import batch
      seen.add(email);
      clean.push({
        user_id: userId,
        project_id: scope.project_id || null,
        intel_profile_id: scope.intel_profile_id || null,
        email,
        first_name: r.firstName || null,
        last_name: r.lastName || null,
        company: r.company || null,
        custom_fields: r.customFields || {},
        tags: r.tags || [],
        source: r.source || 'manual',
        consent_source: r.consentSource || opts.consentSource || null,
        consent_timestamp: r.consentTimestamp || (opts.consentSource ? new Date().toISOString() : null),
      });
    });

    if (!clean.length) return { imported: 0, updated: 0, skipped };

    // Fetch existing rows first so tag merges are additive, not overwritten.
    const emails = clean.map(c => c.email);
    const { data: existing, error: fetchErr } = await client
      .from('contacts')
      .select('id, email, tags, consent_source, consent_timestamp')
      .eq('user_id', userId)
      .in('email', emails);
    if (fetchErr) throw new Error(fetchErr.message);

    const existingByEmail = new Map((existing || []).map(c => [c.email, c]));
    const merged = clean.map((c) => {
      const prior = existingByEmail.get(c.email);
      if (!prior) return c;
      const mergedTags = Array.from(new Set([...(prior.tags || []), ...c.tags]));
      // Never clobber an existing consent record with this import's value —
      // the earliest known lawful basis is the one that matters.
      return {
        ...c,
        tags: mergedTags,
        consent_source: prior.consent_source || c.consent_source,
        consent_timestamp: prior.consent_timestamp || c.consent_timestamp,
      };
    });

    const { data, error } = await client
      .from('contacts')
      .upsert(merged, { onConflict: 'user_id,email' })
      .select();
    if (error) throw new Error(error.message);

    return {
      imported: merged.length - existingByEmail.size,
      updated: existingByEmail.size,
      skipped,
      contacts: data,
    };
  }

  /**
   * @param {Object} [opts]
   * @param {string} [opts.search] - matches email/first_name/last_name/company
   * @param {string} [opts.tag]
   * @param {string} [opts.status]
   * @param {number} [opts.limit]
   * @param {number} [opts.offset]
   */
  async function listContacts(opts = {}) {
    const client = getSupabase();
    const userId = await getUserId();
    if (!client || !userId) return [];

    let q = client.from('contacts').select('*').eq('user_id', userId).order('created_at', { ascending: false });
    if (opts.status) q = q.eq('status', opts.status);
    if (opts.tag) q = q.contains('tags', [opts.tag]);
    if (opts.search) {
      const s = opts.search.replace(/[%_]/g, '');
      q = q.or(`email.ilike.%${s}%,first_name.ilike.%${s}%,last_name.ilike.%${s}%,company.ilike.%${s}%`);
    }
    if (opts.limit) q = q.limit(opts.limit);
    if (opts.offset) q = q.range(opts.offset, opts.offset + (opts.limit || 50) - 1);

    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return data || [];
  }

  async function updateContact(id, patch) {
    const client = getSupabase();
    const userId = await getUserId();
    if (!client || !userId) throw new Error('Sign in required.');
    const { data, error } = await client.from('contacts').update(patch).eq('id', id).eq('user_id', userId).select().single();
    if (error) throw new Error(error.message);
    return data;
  }

  async function unsubscribeContact(id) {
    return updateContact(id, { status: 'unsubscribed' });
  }

  async function deleteContact(id) {
    const client = getSupabase();
    const userId = await getUserId();
    if (!client || !userId) throw new Error('Sign in required.');
    const { error } = await client.from('contacts').delete().eq('id', id).eq('user_id', userId);
    if (error) throw new Error(error.message);
    return true;
  }

  /* ─────────────────────────────────────────────────────────────────────────
     SEGMENTS
  ───────────────────────────────────────────────────────────────────────── */

  /**
   * @param {Object} opts
   * @param {string} opts.name
   * @param {string} [opts.description]
   * @param {'dynamic'|'static'} [opts.memberMode]
   * @param {Object} [opts.filterRules] - { tagsAny?: string[], tagsAll?: string[], status?: string }
   */
  async function createSegment({ name, description, memberMode, filterRules }) {
    const client = getSupabase();
    const userId = await getUserId();
    if (!client || !userId) throw new Error('Sign in to create segments.');
    if (!name) throw new Error('Segment name is required.');

    const scope = getScope() || {};
    const { data, error } = await client.from('segments').insert({
      user_id: userId,
      project_id: scope.project_id || null,
      intel_profile_id: scope.intel_profile_id || null,
      name,
      description: description || null,
      member_mode: memberMode || 'dynamic',
      filter_rules: filterRules || {},
    }).select().single();
    if (error) throw new Error(error.message);
    return data;
  }

  async function listSegments() {
    const client = getSupabase();
    const userId = await getUserId();
    if (!client || !userId) return [];
    const { data, error } = await client.from('segments').select('*').eq('user_id', userId).order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return data || [];
  }

  async function deleteSegment(id) {
    const client = getSupabase();
    const userId = await getUserId();
    if (!client || !userId) throw new Error('Sign in required.');
    const { error } = await client.from('segments').delete().eq('id', id).eq('user_id', userId);
    if (error) throw new Error(error.message);
    return true;
  }

  async function addStaticMembers(segmentId, contactIds) {
    const client = getSupabase();
    if (!client) throw new Error('Sign in required.');
    const rows = contactIds.map(contact_id => ({ segment_id: segmentId, contact_id }));
    const { error } = await client.from('segment_members').upsert(rows, { onConflict: 'segment_id,contact_id' });
    if (error) throw new Error(error.message);
    return true;
  }

  async function removeStaticMembers(segmentId, contactIds) {
    const client = getSupabase();
    if (!client) throw new Error('Sign in required.');
    const { error } = await client.from('segment_members').delete().eq('segment_id', segmentId).in('contact_id', contactIds);
    if (error) throw new Error(error.message);
    return true;
  }

  /**
   * Resolve a segment to its current, sendable contact list. Always excludes
   * unsubscribed/bounced/complained contacts, regardless of filter_rules —
   * a segment can never be used to route around an opt-out.
   * @param {string} segmentId
   * @returns {Promise<Array>} contact rows
   */
  async function resolveSegmentContacts(segmentId) {
    const client = getSupabase();
    const userId = await getUserId();
    if (!client || !userId) throw new Error('Sign in required.');

    const { data: segment, error: segErr } = await client.from('segments').select('*').eq('id', segmentId).single();
    if (segErr) throw new Error(segErr.message);

    const SENDABLE = 'subscribed';

    if (segment.member_mode === 'static') {
      const { data, error } = await client
        .from('segment_members')
        .select('contacts(*)')
        .eq('segment_id', segmentId);
      if (error) throw new Error(error.message);
      return (data || [])
        .map(row => row.contacts)
        .filter(c => c && c.status === SENDABLE);
    }

    const rules = segment.filter_rules || {};
    let q = client.from('contacts').select('*').eq('user_id', userId);
    q = q.eq('status', rules.status || SENDABLE);
    if (rules.tagsAny && rules.tagsAny.length) q = q.overlaps('tags', rules.tagsAny);
    if (rules.tagsAll && rules.tagsAll.length) q = q.contains('tags', rules.tagsAll);

    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return data || [];
  }

  /**
   * Map contact rows to the {to, toName, mergeFields} shape EmailDeliveryService expects.
   */
  function toRecipients(contacts) {
    return (contacts || []).map(c => ({
      to: c.email,
      toName: [c.first_name, c.last_name].filter(Boolean).join(' ') || undefined,
      mergeFields: {
        firstName: c.first_name || '',
        lastName: c.last_name || '',
        company: c.company || '',
        ...(c.custom_fields || {}),
      },
      _contactId: c.id,
    }));
  }

  /**
   * Log the outcome of a send for every recipient — builds send history per
   * contact and lets future sends/reporting see who's already been reached.
   * @param {Object} opts
   * @param {string} opts.campaignId
   * @param {string} [opts.campaignName]
   * @param {string} [opts.subject]
   * @param {string} [opts.segmentId]
   * @param {Array<{to, success, id?, error?, _contactId?}>} opts.results — mixed sent/failed/rejected rows
   */
  async function logCampaignSend({ campaignId, campaignName, subject, segmentId, results }) {
    const client = getSupabase();
    const userId = await getUserId();
    if (!client || !userId || !results || !results.length) return;

    const rows = results.map(r => ({
      user_id: userId,
      contact_id: r._contactId || null,
      campaign_id: campaignId,
      campaign_name: campaignName || null,
      segment_id: segmentId || null,
      email: r.to,
      subject: subject || null,
      status: r.success === true ? 'sent' : (r.error && /reject/i.test(r.error) ? 'rejected' : 'failed'),
      provider_id: r.id || null,
      error: r.success ? null : (r.error || null),
    }));

    const { error } = await client.from('campaign_sends').insert(rows);
    if (error) console.warn('[ContactsStore] failed to log campaign send:', error.message);
  }

  return {
    upsertContacts,
    listContacts,
    updateContact,
    unsubscribeContact,
    deleteContact,
    createSegment,
    listSegments,
    deleteSegment,
    addStaticMembers,
    removeStaticMembers,
    resolveSegmentContacts,
    toRecipients,
    logCampaignSend,
  };
})();
