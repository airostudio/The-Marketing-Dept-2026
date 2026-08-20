/**
 * Marketing Store - Supabase-backed persistent storage for all marketing services
 * Audema Marketing 2026
 *
 * Replaces localStorage usage across marketing services with Supabase persistence.
 * Each service stores data with a service + key identifier.
 * Falls back to localStorage when Supabase is unavailable.
 *
 * Usage:
 *   await MarketingStore.set('cmo', 'kpis', { ... });
 *   const data = await MarketingStore.get('cmo', 'kpis');
 */

(function() {
    'use strict';

    var TAG = '[MarketingStore]';

    // ─────────────────────────────────────────────────────────────────────────
    // SUPABASE HELPERS
    // ─────────────────────────────────────────────────────────────────────────

    async function _client() {
        if (window.Supabase && window.Supabase.ready) {
            try { await window.Supabase.ready(); } catch (e) { /* fall through */ }
        }
        if (window.Supabase && window.Supabase.getClient) {
            return window.Supabase.getClient();
        }
        return null;
    }

    async function _userId() {
        var client = await _client();
        if (!client) return null;
        try {
            var result = await client.auth.getUser();
            return result.data.user ? result.data.user.id : null;
        } catch (e) {
            return null;
        }
    }

    function _projectId() {
        if (window.ProjectService && window.ProjectService.getCurrentProjectSync) {
            var p = window.ProjectService.getCurrentProjectSync();
            return p ? p.id : null;
        }
        return localStorage.getItem('seo-current-project') || null;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // LOCAL STORAGE HELPERS (fallback / cache)
    // ─────────────────────────────────────────────────────────────────────────

    function _lsKey(service, key) {
        return 'mktg-' + service + '-' + key;
    }

    function _lsGet(service, key) {
        try {
            var raw = localStorage.getItem(_lsKey(service, key));
            return raw ? JSON.parse(raw) : null;
        } catch (e) {
            return null;
        }
    }

    function _lsSet(service, key, data) {
        try {
            localStorage.setItem(_lsKey(service, key), JSON.stringify(data));
        } catch (e) {
            console.warn(TAG, 'localStorage write failed:', e.message);
        }
    }

    function _lsRemove(service, key) {
        localStorage.removeItem(_lsKey(service, key));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CORE API
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Get data for a service+key.
     * Returns parsed JSON data, or defaultValue if not found.
     */
    async function get(service, key, defaultValue) {
        if (defaultValue === undefined) defaultValue = null;

        var client = await _client();
        var uid = await _userId();

        if (client && uid) {
            try {
                var query = client
                    .from('marketing_store')
                    .select('data')
                    .eq('user_id', uid)
                    .eq('service', service)
                    .eq('key', key);

                var pid = _projectId();
                if (pid) {
                    query = query.eq('project_id', pid);
                } else {
                    query = query.is('project_id', null);
                }

                var result = await query.maybeSingle();

                if (result.error) {
                    console.warn(TAG, 'Supabase read error:', result.error.message);
                } else if (result.data) {
                    // Cache locally
                    _lsSet(service, key, result.data.data);
                    return result.data.data;
                }
            } catch (e) {
                console.warn(TAG, 'Supabase get failed, using localStorage:', e.message);
            }
        }

        // Fallback to localStorage
        var cached = _lsGet(service, key);
        return cached !== null ? cached : defaultValue;
    }

    /**
     * Save data for a service+key.
     * Persists to Supabase (upsert) and caches in localStorage.
     */
    async function set(service, key, data) {
        // Always cache locally for speed
        _lsSet(service, key, data);

        var client = await _client();
        var uid = await _userId();

        if (client && uid) {
            try {
                var pid = _projectId();
                var row = {
                    user_id: uid,
                    project_id: pid || null,
                    service: service,
                    key: key,
                    data: data,
                    updated_at: new Date().toISOString()
                };

                var result = await client
                    .from('marketing_store')
                    .upsert(row, {
                        onConflict: 'user_id,project_id,service,key'
                    });

                if (result.error) {
                    console.warn(TAG, 'Supabase write error:', result.error.message);
                } else {
                    return true;
                }
            } catch (e) {
                console.warn(TAG, 'Supabase set failed, data saved to localStorage:', e.message);
            }
        }

        return false;
    }

    /**
     * Remove data for a service+key.
     */
    async function remove(service, key) {
        _lsRemove(service, key);

        var client = await _client();
        var uid = await _userId();

        if (client && uid) {
            try {
                var query = client
                    .from('marketing_store')
                    .delete()
                    .eq('user_id', uid)
                    .eq('service', service)
                    .eq('key', key);

                var pid = _projectId();
                if (pid) {
                    query = query.eq('project_id', pid);
                }

                await query;
            } catch (e) {
                console.warn(TAG, 'Supabase remove failed:', e.message);
            }
        }
    }

    /**
     * Get all keys for a service (returns object of key -> data).
     */
    async function getAll(service) {
        var result = {};

        var client = await _client();
        var uid = await _userId();

        if (client && uid) {
            try {
                var query = client
                    .from('marketing_store')
                    .select('key, data')
                    .eq('user_id', uid)
                    .eq('service', service);

                var pid = _projectId();
                if (pid) {
                    query = query.eq('project_id', pid);
                }

                var res = await query;

                if (!res.error && res.data) {
                    res.data.forEach(function(row) {
                        result[row.key] = row.data;
                        // Cache locally
                        _lsSet(service, row.key, row.data);
                    });
                    return result;
                }
            } catch (e) {
                console.warn(TAG, 'Supabase getAll failed:', e.message);
            }
        }

        // Fallback: scan localStorage for this service
        for (var i = 0; i < localStorage.length; i++) {
            var lsKey = localStorage.key(i);
            var prefix = 'mktg-' + service + '-';
            if (lsKey && lsKey.indexOf(prefix) === 0) {
                var dataKey = lsKey.substring(prefix.length);
                try {
                    result[dataKey] = JSON.parse(localStorage.getItem(lsKey));
                } catch (e) { /* skip */ }
            }
        }

        return result;
    }

    /**
     * Sync all localStorage marketing data to Supabase.
     * Call this after user signs in.
     */
    async function syncToSupabase() {
        var client = await _client();
        var uid = await _userId();

        if (!client || !uid) {
            console.log(TAG, 'Cannot sync - not authenticated');
            return false;
        }

        console.log(TAG, 'Syncing localStorage marketing data to Supabase...');
        var synced = 0;

        for (var i = 0; i < localStorage.length; i++) {
            var lsKey = localStorage.key(i);
            if (!lsKey || lsKey.indexOf('mktg-') !== 0) continue;

            // Parse service and key from localStorage key: mktg-{service}-{key}
            var parts = lsKey.substring(5).split('-');
            if (parts.length < 2) continue;

            var service = parts[0];
            var dataKey = parts.slice(1).join('-');

            try {
                var data = JSON.parse(localStorage.getItem(lsKey));
                var pid = _projectId();

                await client
                    .from('marketing_store')
                    .upsert({
                        user_id: uid,
                        project_id: pid || null,
                        service: service,
                        key: dataKey,
                        data: data,
                        updated_at: new Date().toISOString()
                    }, {
                        onConflict: 'user_id,project_id,service,key'
                    });

                synced++;
            } catch (e) {
                console.warn(TAG, 'Sync failed for', lsKey, ':', e.message);
            }
        }

        console.log(TAG, 'Synced', synced, 'items to Supabase');
        return true;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CAMPAIGN CRUD (uses marketing_campaigns table directly)
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Create a marketing campaign.
     */
    async function createCampaign(campaignData) {
        var client = await _client();
        var uid = await _userId();

        var campaign = Object.assign({}, campaignData, {
            id: campaignData.id || undefined,
            user_id: uid,
            project_id: _projectId(),
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        });

        if (client && uid) {
            try {
                var res = await client
                    .from('marketing_campaigns')
                    .insert(campaign)
                    .select()
                    .single();

                if (res.error) throw res.error;

                // Also cache locally
                _addToLocalList('campaigns', res.data);
                return res.data;
            } catch (e) {
                console.warn(TAG, 'Campaign create in Supabase failed:', e.message);
            }
        }

        // Fallback to localStorage
        if (!campaign.id) {
            campaign.id = 'local_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
        }
        _addToLocalList('campaigns', campaign);
        return campaign;
    }

    /**
     * Get all campaigns.
     */
    async function getCampaigns(filters) {
        var client = await _client();
        var uid = await _userId();

        if (client && uid) {
            try {
                var query = client
                    .from('marketing_campaigns')
                    .select('*')
                    .eq('user_id', uid)
                    .order('created_at', { ascending: false });

                if (filters) {
                    if (filters.type) query = query.eq('type', filters.type);
                    if (filters.status) query = query.eq('status', filters.status);
                    if (filters.channel) query = query.eq('channel', filters.channel);
                }

                var pid = _projectId();
                if (pid) query = query.eq('project_id', pid);

                var res = await query;
                if (res.error) throw res.error;

                // Cache locally
                _lsSet('campaigns', 'list', res.data);
                return res.data || [];
            } catch (e) {
                console.warn(TAG, 'Campaign list from Supabase failed:', e.message);
            }
        }

        // Fallback
        var cached = _lsGet('campaigns', 'list');
        return cached || [];
    }

    /**
     * Update a campaign.
     */
    async function updateCampaign(campaignId, updates) {
        var client = await _client();
        var uid = await _userId();

        if (client && uid && !String(campaignId).startsWith('local_')) {
            try {
                var res = await client
                    .from('marketing_campaigns')
                    .update(Object.assign({}, updates, { updated_at: new Date().toISOString() }))
                    .eq('id', campaignId)
                    .select()
                    .single();

                if (res.error) throw res.error;
                return res.data;
            } catch (e) {
                console.warn(TAG, 'Campaign update failed:', e.message);
            }
        }

        // Fallback: update in local list
        var list = _lsGet('campaigns', 'list') || [];
        for (var i = 0; i < list.length; i++) {
            if (list[i].id === campaignId) {
                Object.assign(list[i], updates, { updated_at: new Date().toISOString() });
                _lsSet('campaigns', 'list', list);
                return list[i];
            }
        }
        return null;
    }

    /**
     * Delete a campaign.
     */
    async function deleteCampaign(campaignId) {
        var client = await _client();
        var uid = await _userId();

        if (client && uid && !String(campaignId).startsWith('local_')) {
            try {
                await client
                    .from('marketing_campaigns')
                    .delete()
                    .eq('id', campaignId);
            } catch (e) {
                console.warn(TAG, 'Campaign delete failed:', e.message);
            }
        }

        // Remove from local list
        var list = _lsGet('campaigns', 'list') || [];
        _lsSet('campaigns', 'list', list.filter(function(c) { return c.id !== campaignId; }));
    }

    // Helper to add item to a local list
    function _addToLocalList(listName, item) {
        var list = _lsGet('campaigns', listName) || [];
        list.unshift(item);
        _lsSet('campaigns', listName, list);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // AUTO-SYNC ON AUTH
    // ─────────────────────────────────────────────────────────────────────────

    function _init() {
        window.addEventListener('supabaseAuthChange', function(e) {
            if (e.detail && (e.detail.event === 'SIGNED_IN' || e.detail.event === 'TOKEN_REFRESHED')) {
                // Delay slightly to let other services initialize
                setTimeout(function() {
                    syncToSupabase();
                }, 2000);
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _init);
    } else {
        _init();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PUBLIC API
    // ─────────────────────────────────────────────────────────────────────────

    window.MarketingStore = {
        // Key-value store (for any service)
        get: get,
        set: set,
        remove: remove,
        getAll: getAll,
        syncToSupabase: syncToSupabase,

        // Campaign CRUD
        createCampaign: createCampaign,
        getCampaigns: getCampaigns,
        updateCampaign: updateCampaign,
        deleteCampaign: deleteCampaign
    };

})();
