/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * API CLIENT — Aduma Marketing Platform
 *
 * All persistent data operations route through Supabase when configured.
 * Falls back to localStorage automatically so the app stays functional
 * even without Supabase credentials (offline / demo mode).
 *
 * Public surface is identical to the original so no call-sites need updating.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

'use strict';

class APIClient {
  constructor() {
    this.accessToken  = localStorage.getItem('access_token');
    this.refreshToken = localStorage.getItem('refresh_token');

    // Keep our token mirror in sync whenever Supabase auto-refreshes its JWT
    window.addEventListener('supabaseAuthChange', (e) => {
      const { session } = e.detail || {};
      if (session?.access_token) this._syncSession(session);
    });
  }

  // ── Supabase helpers ────────────────────────────────────────────────────────

  _sb() {
    const s = window.Supabase;
    return (s && s.isConnected()) ? s : null;
  }

  _syncSession(session) {
    if (!session) return;
    this.accessToken  = session.access_token;
    this.refreshToken = session.refresh_token || null;
    localStorage.setItem('access_token', session.access_token);
    if (session.refresh_token) localStorage.setItem('refresh_token', session.refresh_token);
    if (session.user) {
      localStorage.setItem('user', JSON.stringify(this._pub(session.user)));
    }
  }

  _pub(user) {
    return {
      id:        user.id,
      email:     user.email,
      firstname: user.user_metadata?.firstname || user.user_metadata?.first_name || '',
      lastname:  user.user_metadata?.lastname  || user.user_metadata?.last_name  || '',
      plan:      user.user_metadata?.plan      || 'free',
      createdAt: user.created_at,
    };
  }

  // Current Supabase user ID (needed for user-scoped DB queries)
  async _userId() {
    const sb = this._sb();
    if (sb) {
      try {
        const user = await sb.Auth.getUser();
        if (user) return user.id;
      } catch {}
    }
    // Fallback: read from cached user in localStorage
    try {
      const cached = JSON.parse(localStorage.getItem('user') || 'null');
      return cached?.id || null;
    } catch { return null; }
  }

  // Run supabaseCall; on failure (or no Supabase) run localFallback
  async _run(supabaseCall, localFallback) {
    const sb = this._sb();
    if (sb) {
      try {
        return await supabaseCall(sb);
      } catch (err) {
        console.warn('[APIClient] Supabase call failed, using local fallback:', err.message);
      }
    }
    return localFallback ? localFallback() : null;
  }

  // Simple localStorage list helpers for fallback mode
  _lsGet(key)             { try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; } }
  _lsSet(key, val)        { localStorage.setItem(key, JSON.stringify(val)); }
  _lsPush(key, item)      { const arr = this._lsGet(key); arr.unshift(item); this._lsSet(key, arr); return item; }
  _lsUpdate(key, id, upd) {
    const arr = this._lsGet(key).map(x => x.id === id ? { ...x, ...upd } : x);
    this._lsSet(key, arr);
    return arr.find(x => x.id === id) || null;
  }
  _lsRemove(key, id)      { this._lsSet(key, this._lsGet(key).filter(x => x.id !== id)); }

  // ══════════════════════════════════════════════════════════════════════════
  // AUTHENTICATION
  // ══════════════════════════════════════════════════════════════════════════

  async signup(email, password, firstName, lastName, organizationName) {
    const sb = this._sb();
    if (sb) {
      try {
        const data = await sb.Auth.signUp(email, password, {
          firstname:         firstName,
          lastname:          lastName,
          first_name:        firstName,
          last_name:         lastName,
          organization_name: organizationName,
          plan:              'free',
        });
        if (data.user && data.session) {
          this._syncSession(data.session);
          return this._pub(data.user);
        }
      } catch (err) {
        if (err.message?.includes('already') || err.message?.includes('exists')) {
          throw new Error('An account with this email already exists.');
        }
        throw err;
      }
    }

    // Local fallback (demo mode) — create account in localStorage
    const users = this._lsGet('aduma_users');
    if (users.some(u => u.email.toLowerCase() === email.toLowerCase())) {
      throw new Error('An account with this email already exists.');
    }
    const user = {
      id:        'u_' + Date.now(),
      email,
      firstname: firstName,
      lastname:  lastName,
      plan:      'free',
      createdAt: new Date().toISOString(),
    };
    this._lsPush('aduma_users', user);
    const token = 'local_' + user.id;
    this.accessToken = token;
    localStorage.setItem('access_token', token);
    localStorage.setItem('user', JSON.stringify(user));
    return user;
  }

  async login(email, password) {
    const sb = this._sb();
    if (sb) {
      try {
        const data = await sb.Auth.signIn(email, password);
        if (data.user && data.session) {
          this._syncSession(data.session);
          return this._pub(data.user);
        }
      } catch (err) {
        const isCredErr = err.message?.toLowerCase().match(/invalid|credentials|password|email/);
        if (isCredErr) throw new Error('Incorrect email or password.');
        throw err;
      }
    }

    // Local fallback
    const users = this._lsGet('aduma_users');
    const user  = users.find(u => u.email.toLowerCase() === email.toLowerCase());
    if (!user) throw new Error('No account found with this email address.');
    // Passwords in local mode are stored as plain for demo only
    if (user.password && user.password !== password) throw new Error('Incorrect password.');
    const token = 'local_' + user.id;
    this.accessToken = token;
    localStorage.setItem('access_token', token);
    localStorage.setItem('user', JSON.stringify(user));
    return user;
  }

  async logout() {
    const sb = this._sb();
    if (sb) {
      try { await sb.Auth.signOut(); } catch {}
    }

    this.accessToken  = null;
    this.refreshToken = null;
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('user');
  }

  async refreshAccessToken() {
    // Supabase auto-refreshes — we just need to re-read the session
    const sb = this._sb();
    if (sb) {
      try {
        const session = await sb.Auth.getSession();
        if (session?.access_token) {
          this._syncSession(session);
          return true;
        }
      } catch {}
    }
    return false;
  }

  async getCurrentUser() {
    const sb = this._sb();
    if (sb) {
      try {
        const user = await sb.Auth.getUser();
        if (user) return this._pub(user);
      } catch {}
    }
    try {
      return JSON.parse(localStorage.getItem('user') || 'null');
    } catch { return null; }
  }

  isAuthenticated() {
    return !!this.accessToken;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // CUSTOMERS
  // ══════════════════════════════════════════════════════════════════════════

  async getCustomers(filters = {}) {
    return this._run(
      async (sb) => {
        const uid = await this._userId();
        return uid ? await sb.DB.getCustomers(uid, filters) : [];
      },
      () => this._lsGet('aduma_customers')
    );
  }

  async getCustomer(customerId) {
    return this._run(
      async (sb) => {
        const rows = await sb.DB.getCustomers(await this._userId());
        return rows?.find(r => r.id === customerId) || null;
      },
      () => this._lsGet('aduma_customers').find(c => c.id === customerId) || null
    );
  }

  async createCustomer(customerData) {
    const uid = await this._userId();
    return this._run(
      async (sb) => sb.DB.createCustomer({ ...customerData, user_id: uid }),
      () => this._lsPush('aduma_customers', { id: 'c_' + Date.now(), ...customerData })
    );
  }

  async updateCustomer(customerId, updates) {
    return this._run(
      async (sb) => sb.DB.updateCustomer(customerId, updates),
      () => this._lsUpdate('aduma_customers', customerId, updates)
    );
  }

  async deleteCustomer(customerId) {
    return this._run(
      async (sb) => sb.DB.deleteCustomer(customerId),
      () => this._lsRemove('aduma_customers', customerId)
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // HEALTH SCORES
  // ══════════════════════════════════════════════════════════════════════════

  async saveHealthScore(healthScoreData) {
    return this._run(
      async (sb) => sb.DB.saveHealthScore(healthScoreData),
      () => this._lsPush('aduma_health_scores', { id: 'hs_' + Date.now(), ...healthScoreData })
    );
  }

  async getHealthScoreHistory(customerId, limit = 30) {
    return this._run(
      async (sb) => sb.DB.getHealthScoreHistory(customerId, limit),
      () => this._lsGet('aduma_health_scores')
               .filter(h => h.customer_id === customerId)
               .slice(0, limit)
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // CAMPAIGNS
  // ══════════════════════════════════════════════════════════════════════════

  async getCampaigns(filters = {}) {
    return this._run(
      async (sb) => {
        const uid = await this._userId();
        return uid ? await sb.DB.getCampaigns(uid, filters) : [];
      },
      () => this._lsGet('aduma_campaigns')
    );
  }

  async createCampaign(campaignData) {
    const uid = await this._userId();
    return this._run(
      async (sb) => sb.DB.createCampaign({ ...campaignData, user_id: uid }),
      () => this._lsPush('aduma_campaigns', { id: 'camp_' + Date.now(), ...campaignData })
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // LIFECYCLE
  // ══════════════════════════════════════════════════════════════════════════

  async progressLifecycleStage(customerId, fromStage, toStage, metadata = {}) {
    const event = { customer_id: customerId, from_stage: fromStage, to_stage: toStage, metadata };
    return this._run(
      async (sb) => sb.DB.addLifecycleEvent(event),
      () => this._lsPush('aduma_lifecycle', { id: 'lc_' + Date.now(), ...event, created_at: new Date().toISOString() })
    );
  }

  async getLifecycleHistory(customerId) {
    return this._run(
      async (sb) => sb.DB.getLifecycleHistory(customerId),
      () => this._lsGet('aduma_lifecycle').filter(e => e.customer_id === customerId)
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // DEALS
  // ══════════════════════════════════════════════════════════════════════════

  async getDeals(filters = {}) {
    return this._run(
      async (sb) => {
        const uid = await this._userId();
        return uid ? await sb.DB.getDeals(uid, filters) : [];
      },
      () => this._lsGet('aduma_deals')
    );
  }

  async createDeal(dealData) {
    const uid = await this._userId();
    return this._run(
      async (sb) => sb.DB.createDeal({ ...dealData, user_id: uid }),
      () => this._lsPush('aduma_deals', { id: 'd_' + Date.now(), ...dealData })
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ICP
  // ══════════════════════════════════════════════════════════════════════════

  async getICPProfiles() {
    return this._run(
      async (sb) => {
        const uid = await this._userId();
        return uid ? await sb.DB.getIcpProfiles(uid) : [];
      },
      () => this._lsGet('aduma_icp')
    );
  }

  async createICPProfile(icpData) {
    const uid = await this._userId();
    return this._run(
      async (sb) => sb.DB.createIcpProfile({ ...icpData, user_id: uid }),
      () => this._lsPush('aduma_icp', { id: 'icp_' + Date.now(), ...icpData })
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // INTEGRATIONS
  // ══════════════════════════════════════════════════════════════════════════

  async getIntegrations() {
    return this._run(
      async (sb) => {
        const uid = await this._userId();
        return uid ? await sb.DB.getIntegrations(uid) : [];
      },
      () => this._lsGet('aduma_integrations')
    );
  }

  async createIntegration(provider, credentials) {
    const uid = await this._userId();
    return this._run(
      async (sb) => sb.DB.upsertIntegration({ user_id: uid, provider, credentials }),
      () => {
        const integrations = this._lsGet('aduma_integrations');
        const existing = integrations.findIndex(i => i.provider === provider);
        const item = { id: existing >= 0 ? integrations[existing].id : 'int_' + Date.now(), provider, credentials };
        if (existing >= 0) integrations[existing] = item; else integrations.unshift(item);
        this._lsSet('aduma_integrations', integrations);
        return item;
      }
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PROJECTS  (routed to existing Supabase.DB methods)
  // ══════════════════════════════════════════════════════════════════════════

  async getProjects() {
    return this._run(
      async (sb) => {
        const uid = await this._userId();
        return uid ? await sb.DB.getProjects(uid) : [];
      },
      () => this._lsGet('seo-projects')
    );
  }

  async createProject(projectData) {
    const uid = await this._userId();
    return this._run(
      async (sb) => sb.DB.createProject({ ...projectData, user_id: uid }),
      () => this._lsPush('seo-projects', { id: 'proj_' + Date.now(), ...projectData })
    );
  }

  async updateProject(projectId, updates) {
    return this._run(
      async (sb) => sb.DB.updateProject(projectId, updates),
      () => this._lsUpdate('seo-projects', projectId, updates)
    );
  }

  async deleteProject(projectId) {
    return this._run(
      async (sb) => sb.DB.deleteProject(projectId),
      () => this._lsRemove('seo-projects', projectId)
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // BRAND DATA  (Intelligence Engine / Business Brain)
  // ══════════════════════════════════════════════════════════════════════════

  async getBrandData() {
    return this._run(
      async (sb) => {
        const uid = await this._userId();
        if (!uid) return null;
        const row = await sb.DB.getBrandData(uid);
        return row?.data || null;
      },
      () => {
        try { return JSON.parse(localStorage.getItem('business_brain') || 'null'); } catch { return null; }
      }
    );
  }

  async saveBrandData(brandData) {
    // Always write to localStorage for immediate availability to agents
    localStorage.setItem('business_brain', JSON.stringify(brandData));
    return this._run(
      async (sb) => {
        const uid = await this._userId();
        if (!uid) return brandData;
        await sb.DB.saveBrandData(uid, brandData);
        return brandData;
      },
      () => brandData
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORT — Singleton instance
// ═══════════════════════════════════════════════════════════════════════════════

window.apiClient = new APIClient();
