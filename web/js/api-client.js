/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * API CLIENT — Audema Marketing Platform
 * Frontend wrapper for backend REST API calls.
 *
 * Replaces localStorage with persistent backend storage.
 * Handles authentication, error handling, request/response transformation.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

'use strict';

const API_BASE_URL = window.location.hostname === 'localhost'
  ? 'http://localhost:3000/api'
  : '/api'; // Production: same origin

/**
 * APIClient - Centralized API communication layer
 */
class APIClient {
  constructor() {
    this.baseURL = API_BASE_URL;
    this.accessToken = localStorage.getItem('access_token');
    this.refreshToken = localStorage.getItem('refresh_token');
  }

  /**
   * Make authenticated API request
   * @private
   */
  async _request(method, endpoint, data = null, options = {}) {
    const url = `${this.baseURL}${endpoint}`;
    const config = {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      }
    };

    // Add auth token if available
    if (this.accessToken && !options.skipAuth) {
      config.headers.Authorization = `Bearer ${this.accessToken}`;
    }

    // Add body for POST/PUT/PATCH
    if (data && ['POST', 'PUT', 'PATCH'].includes(method)) {
      config.body = JSON.stringify(data);
    }

    try {
      const response = await fetch(url, config);

      let result;
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        result = await response.json();
      } else {
        // Non-JSON response (e.g. HTML error page from a proxy/static server)
        const text = await response.text();
        const err = new Error(`API unavailable (${response.status})`);
        err.isApiUnavailable = true;
        throw err;
      }

      if (!response.ok) {
        // 404 = endpoint doesn't exist (no backend deployed) → treat as unavailable
        if (response.status === 404) {
          const err = new Error(`API endpoint not found (${endpoint})`);
          err.isApiUnavailable = true;
          throw err;
        }

        // Token expired - try to refresh
        if (response.status === 401 && this.refreshToken && !options.skipRefresh) {
          const refreshed = await this.refreshAccessToken();
          if (refreshed) {
            // Retry original request with new token
            return await this._request(method, endpoint, data, { ...options, skipRefresh: true });
          }
        }

        throw new Error(result.error || `HTTP ${response.status}: ${response.statusText}`);
      }

      return result.data || result;

    } catch (error) {
      // Network errors (no server, connection refused, CORS) → treat as unavailable
      if (error instanceof TypeError || error.name === 'TypeError') {
        error.isApiUnavailable = true;
      }
      if (!error.isApiUnavailable) {
        console.error(`[APIClient] ${method} ${endpoint} failed:`, error);
      }
      throw error;
    }
  }

  /**
   * GET request
   */
  async get(endpoint, options = {}) {
    return await this._request('GET', endpoint, null, options);
  }

  /**
   * POST request
   */
  async post(endpoint, data, options = {}) {
    return await this._request('POST', endpoint, data, options);
  }

  /**
   * PUT request
   */
  async put(endpoint, data, options = {}) {
    return await this._request('PUT', endpoint, data, options);
  }

  /**
   * DELETE request
   */
  async delete(endpoint, options = {}) {
    return await this._request('DELETE', endpoint, null, options);
  }

  // ═════════════════════════════════════════════════════════════════════════════
  // AUTHENTICATION
  // ═════════════════════════════════════════════════════════════════════════════

  /**
   * Sign up new user
   */
  async signup(email, password, firstName, lastName, organizationName) {
    const result = await this.post('/auth/signup', {
      email,
      password,
      firstName,
      lastName,
      organizationName
    }, { skipAuth: true });

    this.accessToken = result.accessToken;
    this.refreshToken = result.refreshToken;
    localStorage.setItem('access_token', result.accessToken);
    localStorage.setItem('refresh_token', result.refreshToken);
    localStorage.setItem('user', JSON.stringify(result.user));

    return result.user;
  }

  /**
   * Login
   */
  async login(email, password) {
    const result = await this.post('/auth/login', {
      email,
      password
    }, { skipAuth: true });

    this.accessToken = result.accessToken;
    this.refreshToken = result.refreshToken;
    localStorage.setItem('access_token', result.accessToken);
    localStorage.setItem('refresh_token', result.refreshToken);
    localStorage.setItem('user', JSON.stringify(result.user));

    return result.user;
  }

  /**
   * Logout
   */
  async logout() {
    try {
      await this.post('/auth/logout', {
        refreshToken: this.refreshToken
      });
    } catch (error) {
      console.warn('Logout API call failed:', error);
    }

    this.accessToken = null;
    this.refreshToken = null;
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('user');
  }

  /**
   * Refresh access token
   */
  async refreshAccessToken() {
    try {
      const result = await this.post('/auth/refresh', {
        refreshToken: this.refreshToken
      }, { skipAuth: true, skipRefresh: true });

      this.accessToken = result.accessToken;
      localStorage.setItem('access_token', result.accessToken);
      return true;

    } catch (error) {
      console.error('Token refresh failed:', error);
      await this.logout();
      return false;
    }
  }

  /**
   * Get current user
   */
  async getCurrentUser() {
    return await this.get('/auth/me');
  }

  /**
   * Check if user is authenticated
   */
  isAuthenticated() {
    return !!this.accessToken;
  }

  // ═════════════════════════════════════════════════════════════════════════════
  // CUSTOMERS
  // ═════════════════════════════════════════════════════════════════════════════

  async getCustomers(filters = {}) {
    const query = new URLSearchParams(filters).toString();
    return await this.get(`/customers?${query}`);
  }

  async getCustomer(customerId) {
    return await this.get(`/customers/${customerId}`);
  }

  async createCustomer(customerData) {
    return await this.post('/customers', customerData);
  }

  async updateCustomer(customerId, updates) {
    return await this.put(`/customers/${customerId}`, updates);
  }

  async deleteCustomer(customerId) {
    return await this.delete(`/customers/${customerId}`);
  }

  // ═════════════════════════════════════════════════════════════════════════════
  // HEALTH SCORES
  // ═════════════════════════════════════════════════════════════════════════════

  async saveHealthScore(healthScoreData) {
    return await this.post('/health-scores', healthScoreData);
  }

  async getHealthScoreHistory(customerId, limit = 30) {
    return await this.get(`/health-scores/${customerId}?limit=${limit}`);
  }

  // ═════════════════════════════════════════════════════════════════════════════
  // CAMPAIGNS
  // ═════════════════════════════════════════════════════════════════════════════

  async getCampaigns(filters = {}) {
    const query = new URLSearchParams(filters).toString();
    return await this.get(`/campaigns?${query}`);
  }

  async createCampaign(campaignData) {
    return await this.post('/campaigns', campaignData);
  }

  // ═════════════════════════════════════════════════════════════════════════════
  // LIFECYCLE
  // ═════════════════════════════════════════════════════════════════════════════

  async progressLifecycleStage(customerId, fromStage, toStage, metadata = {}) {
    return await this.post('/lifecycle/progress', {
      customerId,
      fromStage,
      toStage,
      metadata
    });
  }

  async getLifecycleHistory(customerId) {
    return await this.get(`/lifecycle/${customerId}`);
  }

  // ═════════════════════════════════════════════════════════════════════════════
  // DEALS
  // ═════════════════════════════════════════════════════════════════════════════

  async getDeals(filters = {}) {
    const query = new URLSearchParams(filters).toString();
    return await this.get(`/deals?${query}`);
  }

  async createDeal(dealData) {
    return await this.post('/deals', dealData);
  }

  // ═════════════════════════════════════════════════════════════════════════════
  // ICP (Ideal Customer Profile)
  // ═════════════════════════════════════════════════════════════════════════════

  async getICPProfiles() {
    return await this.get('/icp');
  }

  async createICPProfile(icpData) {
    return await this.post('/icp', icpData);
  }

  // ═════════════════════════════════════════════════════════════════════════════
  // INTEGRATIONS
  // ═════════════════════════════════════════════════════════════════════════════

  async getIntegrations() {
    return await this.get('/integrations');
  }

  async createIntegration(provider, credentials) {
    return await this.post('/integrations', { provider, credentials });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORT — Singleton instance
// ═══════════════════════════════════════════════════════════════════════════════

window.apiClient = new APIClient();
