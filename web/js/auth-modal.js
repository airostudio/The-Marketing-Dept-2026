/**
 * AUTH MODAL — Aduma
 *
 * Self-contained login / sign-up modal with built-in localStorage auth.
 * No dependency on window.Auth, window.apiClient, or any external module.
 *
 * Usage:
 *   AuthModal.open('login')   — opens on login tab
 *   AuthModal.open('signup')  — opens on sign-up tab
 *   AuthModal.close()
 *
 * Options:
 *   AuthModal.onSuccess = (user) => { ... }
 *   AuthModal.redirectTo = '/hub.html'
 *
 * Auto-triggers on ?openAuth=login or ?openAuth=signup in the URL.
 */

(function () {
  'use strict';

  // ─── Expose AuthModal immediately so auth.js cannot override it ───────────
  // (auth.js also exports window.AuthModal; loading order matters)
  var _open, _close;
  window.AuthModal = {
    open:       function (tab) { if (_open) _open(tab); },
    close:      function ()    { if (_close) _close(); },
    redirectTo: '/hub.html',
    onSuccess:  null,
  };

  /* ─── Simple built-in auth store ─────────────────────────────────────────
     Uses its own keys so it never conflicts with auth.js or api-client.js.
     After a successful auth it also writes the keys those systems expect so
     the hub/dashboard guards see a valid session.
  ───────────────────────────────────────────────────────────────────────── */

  const STORE_KEY   = 'aduma_users';
  const SESSION_KEY = 'aduma_session';
  const TTL         = 30 * 24 * 60 * 60 * 1000; // 30 days

  // ── Supabase config (fetched once from /api/app-config) ──────────────────
  var _sbConfig = null; // { supabaseUrl, supabaseKey, configured }

  async function _getSupabaseConfig() {
    if (_sbConfig !== null) return _sbConfig;
    // Also check if supabase-client.js already has valid config in APP_CONFIG
    var ac = window.APP_CONFIG || {};
    if (ac.SUPABASE_URL && ac.SUPABASE_ANON_KEY) {
      _sbConfig = { supabaseUrl: ac.SUPABASE_URL, supabaseKey: ac.SUPABASE_ANON_KEY, configured: true };
      return _sbConfig;
    }
    // Fall back to localStorage keys (set via Settings page)
    var lsUrl = localStorage.getItem('supabase-url');
    var lsKey = localStorage.getItem('supabase-anon-key');
    if (lsUrl && lsKey) {
      _sbConfig = { supabaseUrl: lsUrl, supabaseKey: lsKey, configured: true };
      return _sbConfig;
    }
    // Fetch from Vercel env vars via API
    try {
      var r = await fetch('/api/app-config', { signal: AbortSignal.timeout(4000) });
      var d = await r.json();
      _sbConfig = d;
      // Cache in localStorage so SDK also picks it up
      if (d.configured) {
        localStorage.setItem('supabase-url',      d.supabaseUrl);
        localStorage.setItem('supabase-anon-key', d.supabaseKey);
      }
    } catch { _sbConfig = { configured: false }; }
    return _sbConfig;
  }

  // ── Supabase Auth REST (no SDK needed) ───────────────────────────────────
  async function _sbLogin(email, password, cfg) {
    var r = await fetch(`${cfg.supabaseUrl}/auth/v1/token?grant_type=password`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': cfg.supabaseKey },
      body:    JSON.stringify({ email, password }),
      signal:  AbortSignal.timeout(10000),
    });
    var d = await r.json();
    if (!r.ok) throw new Error(d.error_description || d.message || 'Login failed.');
    return d; // { access_token, refresh_token, user: { id, email, user_metadata } }
  }

  async function _sbSignup(email, password, firstname, lastname, org, cfg) {
    var r = await fetch(`${cfg.supabaseUrl}/auth/v1/signup`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': cfg.supabaseKey },
      body:    JSON.stringify({ email, password, data: { firstname, lastname, org } }),
      signal:  AbortSignal.timeout(10000),
    });
    var d = await r.json();
    if (!r.ok) throw new Error(d.error_description || d.message || 'Sign up failed.');
    // Some Supabase configs require email confirmation — if no access_token yet, still succeed
    if (!d.access_token && !d.user) throw new Error(d.error_description || 'Sign up failed.');
    return d;
  }

  // ── Session helpers ───────────────────────────────────────────────────────
  function _createSessionFromSupabase(sbData) {
    var sbUser = sbData.user || {};
    var meta   = sbUser.user_metadata || {};
    var pub = {
      id:        sbUser.id        || 'sb_' + Date.now(),
      email:     sbUser.email     || '',
      firstname: meta.firstname   || meta.first_name  || '',
      lastname:  meta.lastname    || meta.last_name   || '',
      org:       meta.org         || '',
    };
    var accessToken  = sbData.access_token  || '';
    var refreshToken = sbData.refresh_token || '';
    var expiresIn    = sbData.expires_in    || 3600;

    localStorage.setItem(SESSION_KEY, JSON.stringify({
      userId:  pub.id, email: pub.email,
      expires: Date.now() + expiresIn * 1000,
      source:  'supabase',
    }));
    localStorage.setItem('access_token',  accessToken);
    localStorage.setItem('refresh_token', refreshToken);
    localStorage.setItem('user', JSON.stringify(pub));
    if (window.apiClient) { window.apiClient.accessToken = accessToken; window.apiClient.refreshToken = refreshToken; }

    // Bridge for auth.js / dashboard guard
    localStorage.setItem('seo_agent_user', JSON.stringify(pub));
    localStorage.setItem('seo_agent_session', JSON.stringify({
      userId: pub.id, email: pub.email,
      created: Date.now(), expires: Date.now() + expiresIn * 1000, source: 'supabase',
    }));
    return pub;
  }

  function _hash(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) { h = Math.imul(31, h) + str.charCodeAt(i) | 0; }
    return h.toString(36);
  }

  function _getUsers() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || '[]'); } catch { return []; }
  }

  function _createSessionLocal(user) {
    const pub = { id: user.id, email: user.email, firstname: user.firstname, lastname: user.lastname, org: user.org || '' };
    localStorage.setItem(SESSION_KEY, JSON.stringify({ userId: user.id, email: user.email, expires: Date.now() + TTL }));
    const token = 'local_' + user.id;
    if (!localStorage.getItem('access_token') || (localStorage.getItem('access_token') || '').startsWith('local_')) {
      localStorage.setItem('access_token', token);
    }
    localStorage.setItem('user', JSON.stringify(pub));
    if (window.apiClient && (!window.apiClient.accessToken || window.apiClient.accessToken.startsWith('local_'))) {
      window.apiClient.accessToken = token;
    }
    localStorage.setItem('seo_agent_user', JSON.stringify(pub));
    localStorage.setItem('seo_agent_session', JSON.stringify({ userId: user.id, email: user.email, created: Date.now(), expires: Date.now() + TTL, source: 'local' }));
    return pub;
  }

  // ── Auth entry points ─────────────────────────────────────────────────────
  async function authLogin(email, password) {
    var cfg = await _getSupabaseConfig();
    if (cfg && cfg.configured) {
      var data = await _sbLogin(email, password, cfg);
      return _createSessionFromSupabase(data);
    }
    // Fallback: localStorage-only (single browser)
    var users = _getUsers();
    var user  = users.find(u => u.email.toLowerCase() === email.toLowerCase());
    if (!user) throw new Error('No account found. Please create an account first.');
    if (user.password !== _hash(password)) throw new Error('Incorrect password.');
    return _createSessionLocal(user);
  }

  async function authSignup(email, password, firstname, lastname, org) {
    var cfg = await _getSupabaseConfig();
    if (cfg && cfg.configured) {
      var data = await _sbSignup(email, password, firstname, lastname, org, cfg);
      if (data.access_token) return _createSessionFromSupabase(data);
      // Email confirmation required — account created but not yet active
      throw new Error('Check your email to confirm your account, then sign in.');
    }
    // Fallback: localStorage-only
    var users = _getUsers();
    if (users.find(u => u.email.toLowerCase() === email.toLowerCase())) throw new Error('An account with this email already exists.');
    var user = { id: 'u_' + Date.now(), email, firstname, lastname, org: org || '', password: _hash(password) };
    users.push(user);
    localStorage.setItem(STORE_KEY, JSON.stringify(users));
    return _createSessionLocal(user);
  }

  /* ─── CSS ─────────────────────────────────────────────────────────────── */

  const CSS = `
    #auth-modal-overlay {
      position: fixed; inset: 0;
      background: rgba(7,7,17,0.82);
      backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
      z-index: 99999;
      display: flex; align-items: center; justify-content: center; padding: 20px;
      opacity: 0; pointer-events: none; transition: opacity 0.22s ease;
    }
    #auth-modal-overlay.am-open { opacity: 1; pointer-events: all; }
    #auth-modal-box {
      background: #fff; border-radius: 16px;
      box-shadow: 0 32px 80px rgba(0,0,0,0.50);
      width: 100%; max-width: 440px; overflow: hidden;
      transform: translateY(18px) scale(0.97); transition: transform 0.22s ease;
    }
    #auth-modal-overlay.am-open #auth-modal-box { transform: translateY(0) scale(1); }
    .am-header {
      background: linear-gradient(135deg,#667eea,#764ba2);
      color: #fff; padding: 28px 32px 24px; text-align: center; position: relative;
    }
    .am-header h2 { font-size: 24px; font-weight: 800; margin-bottom: 4px; font-family: inherit; }
    .am-header p  { opacity: 0.88; font-size: 13px; font-family: inherit; }
    .am-close {
      position: absolute; top: 14px; right: 16px;
      background: rgba(255,255,255,0.18); border: none; border-radius: 50%;
      width: 30px; height: 30px; font-size: 17px; line-height: 1; cursor: pointer;
      color: #fff; display: flex; align-items: center; justify-content: center;
      transition: background 0.15s; font-family: inherit;
    }
    .am-close:hover { background: rgba(255,255,255,0.30); }
    .am-tabs { display: flex; border-bottom: 1px solid #e5e7eb; }
    .am-tab {
      flex: 1; padding: 14px; text-align: center; background: none; border: none;
      border-bottom: 2px solid transparent; cursor: pointer;
      font-size: 14px; font-weight: 600; color: #6b7280;
      transition: all 0.18s; font-family: inherit;
    }
    .am-tab.am-active { color: #667eea; border-bottom-color: #667eea; }
    .am-body { padding: 28px 32px 24px; }
    .am-alert {
      padding: 11px 14px; border-radius: 7px; margin-bottom: 18px;
      font-size: 13px; display: none; font-family: inherit;
    }
    .am-alert.am-show { display: block; }
    .am-alert.am-error   { background: #fee2e2; color: #dc2626; }
    .am-alert.am-success { background: #d1fae5; color: #059669; }
    .am-form { display: none; }
    .am-form.am-active { display: block; }
    .am-field { margin-bottom: 16px; }
    .am-field label {
      display: block; margin-bottom: 5px;
      font-size: 13px; font-weight: 600; color: #374151; font-family: inherit;
    }
    .am-field input {
      width: 100%; padding: 11px 14px;
      border: 1px solid #d1d5db; border-radius: 8px;
      font-size: 14px; font-family: inherit; color: #111;
      transition: border-color 0.18s, box-shadow 0.18s;
      outline: none; box-sizing: border-box;
    }
    .am-field input:focus {
      border-color: #667eea; box-shadow: 0 0 0 3px rgba(102,126,234,0.12);
    }
    .am-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .am-submit {
      width: 100%; padding: 13px;
      background: linear-gradient(135deg,#667eea,#764ba2);
      color: #fff; border: none; border-radius: 8px;
      font-size: 14px; font-weight: 700; cursor: pointer; font-family: inherit;
      transition: transform 0.15s, box-shadow 0.15s, opacity 0.15s;
      display: flex; align-items: center; justify-content: center; gap: 8px;
    }
    .am-submit:hover  { transform: translateY(-1px); box-shadow: 0 6px 18px rgba(102,126,234,0.4); }
    .am-submit:active { transform: translateY(0); box-shadow: none; }
    .am-submit:disabled { opacity: 0.55; cursor: not-allowed; transform: none; box-shadow: none; }
    .am-spinner {
      display: inline-block; width: 14px; height: 14px;
      border: 2px solid rgba(255,255,255,0.4); border-top-color: #fff;
      border-radius: 50%; animation: am-spin 0.7s linear infinite;
    }
    @keyframes am-spin { to { transform: rotate(360deg); } }
    .am-note {
      margin-top: 18px; padding: 10px 12px; background: #f3f4f6;
      border-radius: 7px; font-size: 12px; color: #6b7280;
      text-align: center; font-family: inherit;
    }
    @media (max-width: 480px) {
      #auth-modal-box { border-radius: 14px; }
      .am-body { padding: 20px; }
      .am-header { padding: 22px 20px 18px; }
      .am-row { grid-template-columns: 1fr; gap: 0; }
    }
  `;

  /* ─── HTML ────────────────────────────────────────────────────────────── */

  const HTML = `
    <div id="auth-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="am-title">
      <div id="auth-modal-box">
        <div class="am-header">
          <h2 id="am-title">Aduma</h2>
          <p>Your AI Marketing Department</p>
          <button class="am-close" id="am-close-btn" aria-label="Close">&times;</button>
        </div>
        <div class="am-tabs">
          <button class="am-tab am-active" data-tab="login">Sign In</button>
          <button class="am-tab" data-tab="signup">Create Account</button>
        </div>
        <div class="am-body">
          <div class="am-alert am-error"   id="am-error"></div>
          <div class="am-alert am-success" id="am-success"></div>

          <form class="am-form am-active" id="am-login-form" novalidate>
            <div class="am-field">
              <label for="am-login-email">Email</label>
              <input type="email" id="am-login-email" placeholder="you@example.com" autocomplete="email" required>
            </div>
            <div class="am-field">
              <label for="am-login-pwd">Password</label>
              <input type="password" id="am-login-pwd" placeholder="Your password" autocomplete="current-password" required>
            </div>
            <button type="submit" class="am-submit" id="am-login-btn">Sign In</button>
          </form>

          <form class="am-form" id="am-signup-form" novalidate>
            <div class="am-row">
              <div class="am-field">
                <label for="am-first">First name</label>
                <input type="text" id="am-first" placeholder="Jane" autocomplete="given-name" required>
              </div>
              <div class="am-field">
                <label for="am-last">Last name</label>
                <input type="text" id="am-last" placeholder="Smith" autocomplete="family-name" required>
              </div>
            </div>
            <div class="am-field">
              <label for="am-signup-email">Email</label>
              <input type="email" id="am-signup-email" placeholder="you@example.com" autocomplete="email" required>
            </div>
            <div class="am-field">
              <label for="am-signup-pwd">Password</label>
              <input type="password" id="am-signup-pwd" placeholder="Min 8 characters" autocomplete="new-password" required minlength="8">
            </div>
            <div class="am-field">
              <label for="am-org">Organisation name</label>
              <input type="text" id="am-org" placeholder="Acme Corp" required>
            </div>
            <button type="submit" class="am-submit" id="am-signup-btn">Create Account</button>
          </form>

          <div class="am-note">Secure &bull; Data stored in your account &bull; Access from any device</div>
        </div>
      </div>
    </div>
  `;

  /* ─── Injection ───────────────────────────────────────────────────────── */

  var _injected = false;

  function inject() {
    if (_injected || document.getElementById('auth-modal-overlay')) { _injected = true; return; }
    _injected = true;

    var style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    var wrap = document.createElement('div');
    wrap.innerHTML = HTML;
    document.body.appendChild(wrap.firstElementChild);

    bindEvents();
  }

  /* ─── Events ──────────────────────────────────────────────────────────── */

  function bindEvents() {
    var overlay = document.getElementById('auth-modal-overlay');
    if (!overlay) return;

    document.getElementById('am-close-btn').addEventListener('click', closeModal);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closeModal(); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && overlay.classList.contains('am-open')) closeModal();
    });
    overlay.querySelectorAll('.am-tab').forEach(function (tab) {
      tab.addEventListener('click', function () { switchTab(tab.dataset.tab); });
    });
    document.getElementById('am-login-form').addEventListener('submit', handleLogin);
    document.getElementById('am-signup-form').addEventListener('submit', handleSignup);
  }

  function switchTab(tab) {
    document.querySelectorAll('.am-tab').forEach(function (t) {
      t.classList.toggle('am-active', t.dataset.tab === tab);
    });
    document.querySelectorAll('.am-form').forEach(function (f) {
      f.classList.toggle('am-active', f.id === 'am-' + tab + '-form');
    });
    clearMessages();
  }

  /* ─── Handlers ────────────────────────────────────────────────────────── */

  async function handleLogin(e) {
    e.preventDefault();
    clearMessages();
    var email = document.getElementById('am-login-email').value.trim();
    var pwd   = document.getElementById('am-login-pwd').value;
    if (!email || !pwd) { showError('Please fill in all fields.'); return; }

    var btn = document.getElementById('am-login-btn');
    setLoading(btn, 'Signing in…');

    try {
      await authLogin(email, pwd);
      showSuccess('Signed in! Taking you in…');
      setTimeout(onSuccess, 900);
    } catch (err) {
      showError(err.message || 'Sign in failed.');
      resetBtn(btn, 'Sign In');
    }
  }

  async function handleSignup(e) {
    e.preventDefault();
    clearMessages();
    var first = document.getElementById('am-first').value.trim();
    var last  = document.getElementById('am-last').value.trim();
    var email = document.getElementById('am-signup-email').value.trim();
    var pwd   = document.getElementById('am-signup-pwd').value;
    var org   = document.getElementById('am-org').value.trim();

    if (!first || !last || !email || !pwd || !org) { showError('Please fill in all fields.'); return; }
    if (pwd.length < 8) { showError('Password must be at least 8 characters.'); return; }

    var btn = document.getElementById('am-signup-btn');
    setLoading(btn, 'Creating account…');

    try {
      await authSignup(email, pwd, first, last, org);
      showSuccess('Account created! Taking you in…');
      setTimeout(onSuccess, 900);
    } catch (err) {
      showError(err.message || 'Sign up failed. Please try again.');
      resetBtn(btn, 'Create Account');
    }
  }

  /* ─── Helpers ─────────────────────────────────────────────────────────── */

  function onSuccess() {
    if (typeof window.AuthModal.onSuccess === 'function') {
      window.AuthModal.onSuccess();
    } else {
      window.location.href = window.AuthModal.redirectTo || '/hub.html';
    }
  }

  function setLoading(btn, label) {
    btn.disabled = true;
    btn.innerHTML = label + ' <span class="am-spinner"></span>';
  }

  function resetBtn(btn, label) {
    btn.disabled = false;
    btn.textContent = label;
  }

  function showError(msg) {
    var el = document.getElementById('am-error');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('am-show');
  }

  function showSuccess(msg) {
    var el = document.getElementById('am-success');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('am-show');
  }

  function clearMessages() {
    var err = document.getElementById('am-error');
    var suc = document.getElementById('am-success');
    if (err) err.classList.remove('am-show');
    if (suc) suc.classList.remove('am-show');
  }

  /* ─── Open / Close ────────────────────────────────────────────────────── */

  function openModal(tab) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { _doOpen(tab); });
    } else {
      _doOpen(tab);
    }
  }

  function _doOpen(tab) {
    inject();
    clearMessages();
    if (tab) switchTab(tab);
    var overlay = document.getElementById('auth-modal-overlay');
    if (overlay) {
      overlay.classList.add('am-open');
      setTimeout(function () {
        var first = overlay.querySelector('.am-form.am-active input');
        if (first) first.focus();
      }, 220);
    }
  }

  function closeModal() {
    var overlay = document.getElementById('auth-modal-overlay');
    if (overlay) overlay.classList.remove('am-open');
  }

  /* ─── Session check ──────────────────────────────────────────────────── */

  function isLoggedIn() {
    // Primary: Supabase session key with expiry
    try {
      var s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
      if (s && s.expires > Date.now()) return true;
    } catch (e) {}
    // Fallback: a bridge token written by a previous login still exists
    return !!localStorage.getItem('access_token');
  }

  /* ─── URL param auto-open ─────────────────────────────────────────────── */

  function checkUrlParam() {
    var param = new URLSearchParams(window.location.search).get('openAuth');
    if (param === 'login' || param === 'signup') {
      // Clean the URL regardless
      var url = new URL(window.location.href);
      url.searchParams.delete('openAuth');
      history.replaceState(null, '', url.toString());

      // Already logged in → go straight to hub, don't show modal
      if (isLoggedIn()) {
        window.location.href = window.AuthModal.redirectTo || '/hub.html';
        return;
      }
      openModal(param);
    }
  }

  /* ─── Boot ────────────────────────────────────────────────────────────── */

  function authLogout() {
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('user');
    localStorage.removeItem('seo_agent_user');
    localStorage.removeItem('seo_agent_session');
    _sbConfig = null; // Reset cache so next login re-checks
  }

  // Wire up the already-exposed AuthModal
  _open  = openModal;
  _close = closeModal;
  window.AuthModal.isLoggedIn = isLoggedIn;
  window.AuthModal.logout     = authLogout;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { inject(); checkUrlParam(); });
  } else {
    inject();
    checkUrlParam();
  }

})();
