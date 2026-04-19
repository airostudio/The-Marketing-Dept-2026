/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * AUTH MODULE — Audema Marketing Platform
 *
 * Single source of truth for authentication state.
 * All auth operations delegate to api-client.js (JWT backend).
 *
 * Storage keys (must match api-client.js):
 *   localStorage['access_token']  — JWT access token
 *   localStorage['refresh_token'] — JWT refresh token
 *   localStorage['user']          — JSON user object
 *
 * Previous demo/Supabase fallback mode has been removed.
 * All auth is now handled by the backend Express API via JWTs.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

'use strict';

const Auth = {
  // ── State checks ──────────────────────────────────────────────────────────

  /**
   * Synchronous check — safe to call anywhere without await.
   * Returns true only if an access token is present in storage.
   * NOTE: does not validate the token signature (use isAuthenticated() for that).
   */
  isAuthenticatedSync() {
    return !!localStorage.getItem('access_token');
  },

  /**
   * Async check — verifies the stored token is still accepted by the backend.
   * Falls back to sync check if apiClient is unavailable.
   */
  async isAuthenticated() {
    if (!window.apiClient) return this.isAuthenticatedSync();
    return window.apiClient.isAuthenticated();
  },

  // ── User data ─────────────────────────────────────────────────────────────

  /**
   * Synchronous user read from localStorage cache.
   * Returns the user object stored on last login/signup, or null.
   */
  getUserSync() {
    try {
      const raw = localStorage.getItem('user');
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  },

  /**
   * Async user read — fetches fresh data from the backend.
   * Falls back to cached data if the API call fails.
   */
  async getUser() {
    if (!window.apiClient) return this.getUserSync();
    try {
      return await window.apiClient.getCurrentUser();
    } catch (_) {
      return this.getUserSync();
    }
  },

  // ── Auth actions ──────────────────────────────────────────────────────────

  /**
   * Login with email + password.
   * Stores tokens and user in localStorage via api-client.
   * @param {string} email
   * @param {string} password
   * @returns {Promise<Object>} user object
   */
  async login(email, password) {
    if (!window.apiClient) throw new Error('API client not initialised');
    return window.apiClient.login(email, password);
  },

  /**
   * Register a new account.
   * @param {{firstname, lastname, email, password, organizationName}} userData
   * @returns {Promise<Object>} user object
   */
  async register({ firstname, lastname, email, password, organizationName = 'My Organisation' }) {
    if (!window.apiClient) throw new Error('API client not initialised');
    return window.apiClient.signup(email, password, firstname, lastname, organizationName);
  },

  /**
   * Logout — calls backend to invalidate the refresh token, then clears storage.
   */
  async logout() {
    if (!window.apiClient) {
      localStorage.removeItem('access_token');
      localStorage.removeItem('refresh_token');
      localStorage.removeItem('user');
      return;
    }
    await window.apiClient.logout();
  },

  /**
   * Redirect to auth page if not authenticated.
   * Call this at the top of any protected page.
   * @param {string} [redirectTo] — path to return to after login (defaults to current page)
   */
  requireAuth(redirectTo) {
    if (!this.isAuthenticatedSync()) {
      const target = redirectTo || window.location.pathname;
      sessionStorage.setItem('auth_redirect', target);
      window.location.href = '/auth.html';
    }
  },
};


// ═══════════════════════════════════════════════════════════════════════════════
// AUTH MODAL CONTROLLER
// Used by pages that embed the auth modal rather than using auth.html standalone.
// ═══════════════════════════════════════════════════════════════════════════════

const AuthModal = {
  modal:       null,
  currentTab: 'login',

  init() {
    this.modal = document.getElementById('authModal');
    if (!this.modal) return;

    this._bindEvents();
    this._interceptDashboardLinks();
  },

  // ── Public ────────────────────────────────────────────────────────────────

  open(tab = 'login') {
    if (!this.modal) return;
    this._switchTab(tab);
    this.modal.classList.add('active');
    document.body.style.overflow = 'hidden';
    setTimeout(() => {
      const first = this.modal.querySelector(`.auth-form.active input:not([type="checkbox"])`);
      if (first) first.focus();
    }, 100);
  },

  close() {
    if (!this.modal) return;
    this.modal.classList.remove('active');
    document.body.style.overflow = '';
    this._clearErrors();
    this._resetForms();
  },

  // ── Private ───────────────────────────────────────────────────────────────

  _switchTab(tab) {
    this.currentTab = tab;
    this.modal.querySelectorAll('.auth-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.tab === tab);
    });
    this.modal.querySelectorAll('.auth-form').forEach(f => {
      f.classList.toggle('active', f.dataset.form === tab);
    });
    this._clearErrors();
  },

  _bindEvents() {
    // Close
    const closeBtn = document.getElementById('closeAuthModal');
    if (closeBtn) closeBtn.addEventListener('click', () => this.close());
    this.modal.addEventListener('click', e => { if (e.target === this.modal) this.close(); });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && this.modal.classList.contains('active')) this.close();
    });

    // Tab switching
    this.modal.querySelectorAll('.auth-tab').forEach(tab => {
      tab.addEventListener('click', () => this._switchTab(tab.dataset.tab));
    });

    // Password visibility toggles
    this.modal.querySelectorAll('.toggle-password').forEach(btn => {
      btn.addEventListener('click', () => this._togglePasswordVisibility(btn));
    });

    // Form submissions
    const loginForm    = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');
    if (loginForm)    loginForm.addEventListener('submit',    e => this._handleLogin(e));
    if (registerForm) registerForm.addEventListener('submit', e => this._handleRegister(e));
  },

  _interceptDashboardLinks() {
    document.querySelectorAll('a[href="dashboard.html"], a[href="/dashboard.html"]').forEach(link => {
      link.addEventListener('click', e => {
        if (!Auth.isAuthenticatedSync()) {
          e.preventDefault();
          this.open('login');
        }
      });
    });
  },

  _togglePasswordVisibility(btn) {
    const input     = btn.closest('.password-input-wrapper')?.querySelector('input');
    const eyeOpen   = btn.querySelector('.eye-open');
    const eyeClosed = btn.querySelector('.eye-closed');
    if (!input) return;
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    if (eyeOpen)   eyeOpen.style.display   = show ? 'none'  : 'block';
    if (eyeClosed) eyeClosed.style.display = show ? 'block' : 'none';
  },

  async _handleLogin(e) {
    e.preventDefault();
    const form   = e.target;
    const btn    = form.querySelector('button[type="submit"]');
    const errDiv = document.getElementById('loginError');
    const email    = form.querySelector('#login-email')?.value    || form.querySelector('[name="email"]')?.value;
    const password = form.querySelector('#login-password')?.value || form.querySelector('[name="password"]')?.value;

    btn.classList.add('loading');
    btn.disabled = true;
    this._clearErrors();

    try {
      await Auth.login(email, password);
      this.close();
      // Redirect to original destination or hub
      const dest = sessionStorage.getItem('auth_redirect') || '/hub.html';
      sessionStorage.removeItem('auth_redirect');
      window.location.href = dest;
    } catch (err) {
      if (errDiv) { errDiv.textContent = err.message; errDiv.classList.add('visible'); }
    } finally {
      btn.classList.remove('loading');
      btn.disabled = false;
    }
  },

  async _handleRegister(e) {
    e.preventDefault();
    const form   = e.target;
    const btn    = form.querySelector('button[type="submit"]');
    const errDiv = document.getElementById('registerError');

    const userData = {
      firstname:        form.querySelector('#register-firstname')?.value,
      lastname:         form.querySelector('#register-lastname')?.value,
      email:            form.querySelector('#register-email')?.value,
      password:         form.querySelector('#register-password')?.value,
      organizationName: form.querySelector('#register-org')?.value || 'My Organisation',
    };

    if (!form.querySelector('#accept-terms')?.checked) {
      if (errDiv) { errDiv.textContent = 'Please accept the Terms of Service.'; errDiv.classList.add('visible'); }
      return;
    }

    btn.classList.add('loading');
    btn.disabled = true;
    this._clearErrors();

    try {
      await Auth.register(userData);
      this.close();
      const dest = sessionStorage.getItem('auth_redirect') || '/hub.html';
      sessionStorage.removeItem('auth_redirect');
      window.location.href = dest;
    } catch (err) {
      if (errDiv) { errDiv.textContent = err.message; errDiv.classList.add('visible'); }
    } finally {
      btn.classList.remove('loading');
      btn.disabled = false;
    }
  },

  _clearErrors() {
    this.modal.querySelectorAll('.auth-error').forEach(el => {
      el.textContent = '';
      el.classList.remove('visible');
    });
  },

  _resetForms() {
    this.modal.querySelectorAll('form').forEach(f => f.reset());
  },
};


// ═══════════════════════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
  AuthModal.init();

  // If page was reached via requireAuth redirect, auto-open login
  const redirectDest = sessionStorage.getItem('auth_redirect');
  if (redirectDest && AuthModal.modal) {
    setTimeout(() => AuthModal.open('login'), 300);
  }
});

window.Auth      = Auth;
window.AuthModal = AuthModal;
