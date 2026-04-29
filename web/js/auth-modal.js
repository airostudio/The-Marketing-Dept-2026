/**
 * ═══════════════════════════════════════════════════════════════════
 * AUTH MODAL — Audema
 *
 * Self-contained login / sign-up modal. Include this script on any
 * page and call AuthModal.open() instead of redirecting to auth.html.
 *
 * Usage:
 *   AuthModal.open('login')   — opens on login tab
 *   AuthModal.open('signup')  — opens on sign-up tab
 *   AuthModal.close()
 *
 * Options (set before calling open):
 *   AuthModal.onSuccess = (user) => { ... }   — custom callback after login
 *   AuthModal.redirectTo = '/hub.html'         — default redirect on success
 *
 * Auto-triggers:
 *   ?openAuth=login  or  ?openAuth=signup  in the URL
 * ═══════════════════════════════════════════════════════════════════
 */

(function () {
  'use strict';

  const CSS = `
    #auth-modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(7, 7, 17, 0.82);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      z-index: 9999;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.22s ease;
    }
    #auth-modal-overlay.am-open {
      opacity: 1;
      pointer-events: all;
    }
    #auth-modal-box {
      background: #fff;
      border-radius: 16px;
      box-shadow: 0 32px 80px rgba(0,0,0,0.50);
      width: 100%;
      max-width: 440px;
      overflow: hidden;
      transform: translateY(18px) scale(0.97);
      transition: transform 0.22s ease;
    }
    #auth-modal-overlay.am-open #auth-modal-box {
      transform: translateY(0) scale(1);
    }
    .am-header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: #fff;
      padding: 28px 32px 24px;
      text-align: center;
      position: relative;
    }
    .am-header h2 {
      font-size: 24px;
      font-weight: 800;
      margin-bottom: 4px;
      font-family: inherit;
    }
    .am-header p {
      opacity: 0.88;
      font-size: 13px;
      font-family: inherit;
    }
    .am-close {
      position: absolute;
      top: 14px;
      right: 16px;
      background: rgba(255,255,255,0.18);
      border: none;
      border-radius: 50%;
      width: 30px;
      height: 30px;
      font-size: 17px;
      line-height: 1;
      cursor: pointer;
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.15s;
      font-family: inherit;
    }
    .am-close:hover { background: rgba(255,255,255,0.30); }
    .am-tabs {
      display: flex;
      border-bottom: 1px solid #e5e7eb;
    }
    .am-tab {
      flex: 1;
      padding: 14px;
      text-align: center;
      background: none;
      border: none;
      border-bottom: 2px solid transparent;
      cursor: pointer;
      font-size: 14px;
      font-weight: 600;
      color: #6b7280;
      transition: all 0.18s;
      font-family: inherit;
    }
    .am-tab.am-active {
      color: #667eea;
      border-bottom-color: #667eea;
    }
    .am-body { padding: 28px 32px 24px; }
    .am-alert {
      padding: 11px 14px;
      border-radius: 7px;
      margin-bottom: 18px;
      font-size: 13px;
      display: none;
      font-family: inherit;
    }
    .am-alert.am-show { display: block; }
    .am-alert.am-error   { background: #fee2e2; color: #dc2626; }
    .am-alert.am-success { background: #d1fae5; color: #059669; }
    .am-form { display: none; }
    .am-form.am-active { display: block; }
    .am-field { margin-bottom: 16px; }
    .am-field label {
      display: block;
      margin-bottom: 5px;
      font-size: 13px;
      font-weight: 600;
      color: #374151;
      font-family: inherit;
    }
    .am-field input {
      width: 100%;
      padding: 11px 14px;
      border: 1px solid #d1d5db;
      border-radius: 8px;
      font-size: 14px;
      font-family: inherit;
      color: #111;
      transition: border-color 0.18s, box-shadow 0.18s;
      outline: none;
      box-sizing: border-box;
    }
    .am-field input:focus {
      border-color: #667eea;
      box-shadow: 0 0 0 3px rgba(102,126,234,0.12);
    }
    .am-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .am-submit {
      width: 100%;
      padding: 13px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: #fff;
      border: none;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 700;
      cursor: pointer;
      font-family: inherit;
      transition: transform 0.15s, box-shadow 0.15s, opacity 0.15s;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
    }
    .am-submit:hover { transform: translateY(-1px); box-shadow: 0 6px 18px rgba(102,126,234,0.4); }
    .am-submit:active { transform: translateY(0); box-shadow: none; }
    .am-submit:disabled { opacity: 0.55; cursor: not-allowed; transform: none; box-shadow: none; }
    .am-spinner {
      display: inline-block;
      width: 14px;
      height: 14px;
      border: 2px solid rgba(255,255,255,0.4);
      border-top-color: #fff;
      border-radius: 50%;
      animation: am-spin 0.7s linear infinite;
    }
    @keyframes am-spin { to { transform: rotate(360deg); } }
    .am-note {
      margin-top: 18px;
      padding: 10px 12px;
      background: #f3f4f6;
      border-radius: 7px;
      font-size: 12px;
      color: #6b7280;
      text-align: center;
      font-family: inherit;
    }
    @media (max-width: 480px) {
      #auth-modal-box { border-radius: 14px; }
      .am-body { padding: 20px; }
      .am-header { padding: 22px 20px 18px; }
      .am-row { grid-template-columns: 1fr; gap: 0; }
    }
  `;

  const HTML = `
    <div id="auth-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="am-title">
      <div id="auth-modal-box">
        <div class="am-header">
          <h2 id="am-title">🚀 Audema</h2>
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

          <!-- LOGIN -->
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

          <!-- SIGNUP -->
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

          <div class="am-note">🔒 Secure • Data stored in your account • Access from any device</div>
        </div>
      </div>
    </div>
  `;

  function inject() {
    if (document.getElementById('auth-modal-overlay')) return; // already injected

    // CSS
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    // HTML
    const wrap = document.createElement('div');
    wrap.innerHTML = HTML;
    document.body.appendChild(wrap.firstElementChild);

    bindEvents();
    checkUrlParam();
  }

  function bindEvents() {
    const overlay = document.getElementById('auth-modal-overlay');

    // Close button
    document.getElementById('am-close-btn').addEventListener('click', close);

    // Overlay click → close
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

    // Keyboard Escape → close
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && overlay.classList.contains('am-open')) close();
    });

    // Tab switching
    overlay.querySelectorAll('.am-tab').forEach(tab => {
      tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });

    // Login submit
    document.getElementById('am-login-form').addEventListener('submit', handleLogin);

    // Signup submit
    document.getElementById('am-signup-form').addEventListener('submit', handleSignup);
  }

  function switchTab(tab) {
    document.querySelectorAll('.am-tab').forEach(t =>
      t.classList.toggle('am-active', t.dataset.tab === tab));
    document.querySelectorAll('.am-form').forEach(f =>
      f.classList.toggle('am-active', f.id === `am-${tab}-form`));
    clearMessages();
  }

  async function handleLogin(e) {
    e.preventDefault();
    clearMessages();
    const email = document.getElementById('am-login-email').value.trim();
    const pwd   = document.getElementById('am-login-pwd').value;
    if (!email || !pwd) { showError('Please fill in all fields.'); return; }

    const btn = document.getElementById('am-login-btn');
    setLoading(btn, 'Signing in…');

    try {
      await _login(email, pwd);
      showSuccess('Signed in! Taking you in…');
      setTimeout(onSuccess, 900);
    } catch (err) {
      showError(err.message || 'Sign in failed. Check your credentials.');
      resetBtn(btn, 'Sign In');
    }
  }

  async function _login(email, pwd) {
    if (window.apiClient) {
      try {
        return await window.apiClient.login(email, pwd);
      } catch (err) {
        if (err.isApiUnavailable && window.Auth) {
          return await window.Auth.login(email, pwd);
        }
        throw err;
      }
    }
    if (window.Auth) return await window.Auth.login(email, pwd);
    throw new Error('Auth service not loaded.');
  }

  async function handleSignup(e) {
    e.preventDefault();
    clearMessages();
    const first = document.getElementById('am-first').value.trim();
    const last  = document.getElementById('am-last').value.trim();
    const email = document.getElementById('am-signup-email').value.trim();
    const pwd   = document.getElementById('am-signup-pwd').value;
    const org   = document.getElementById('am-org').value.trim();
    if (!first || !last || !email || !pwd || !org) { showError('Please fill in all fields.'); return; }
    if (pwd.length < 8) { showError('Password must be at least 8 characters.'); return; }

    const btn = document.getElementById('am-signup-btn');
    setLoading(btn, 'Creating account…');

    try {
      await _signup(email, pwd, first, last, org);
      showSuccess('Account created! Taking you in…');
      setTimeout(onSuccess, 900);
    } catch (err) {
      showError(err.message || 'Sign up failed. Please try again.');
      resetBtn(btn, 'Create Account');
    }
  }

  async function _signup(email, pwd, first, last, org) {
    if (window.apiClient) {
      try {
        return await window.apiClient.signup(email, pwd, first, last, org);
      } catch (err) {
        if (err.isApiUnavailable && window.Auth) {
          return await window.Auth.register({ email, password: pwd, firstname: first, lastname: last });
        }
        throw err;
      }
    }
    if (window.Auth) return await window.Auth.register({ email, password: pwd, firstname: first, lastname: last });
    throw new Error('Auth service not loaded.');
  }

  function onSuccess() {
    if (typeof AuthModal.onSuccess === 'function') {
      AuthModal.onSuccess();
    } else {
      window.location.href = AuthModal.redirectTo || '/hub.html';
    }
  }

  function setLoading(btn, label) {
    btn.disabled = true;
    btn.innerHTML = `${label} <span class="am-spinner"></span>`;
  }

  function resetBtn(btn, label) {
    btn.disabled = false;
    btn.textContent = label;
  }

  function showError(msg) {
    const el = document.getElementById('am-error');
    el.textContent = msg;
    el.classList.add('am-show');
  }

  function showSuccess(msg) {
    const el = document.getElementById('am-success');
    el.textContent = msg;
    el.classList.add('am-show');
  }

  function clearMessages() {
    document.getElementById('am-error')?.classList.remove('am-show');
    document.getElementById('am-success')?.classList.remove('am-show');
  }

  // Auto-open if URL has ?openAuth=login or ?openAuth=signup
  function checkUrlParam() {
    const param = new URLSearchParams(window.location.search).get('openAuth');
    if (param === 'login' || param === 'signup') {
      open(param);
      // Clean URL without reload
      const url = new URL(window.location.href);
      url.searchParams.delete('openAuth');
      history.replaceState(null, '', url.toString());
    }
  }

  function open(tab) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => _open(tab));
    } else {
      _open(tab);
    }
  }

  function _open(tab) {
    inject();
    clearMessages();
    if (tab) switchTab(tab);
    const overlay = document.getElementById('auth-modal-overlay');
    if (overlay) {
      overlay.classList.add('am-open');
      // Focus the first input in the active form
      setTimeout(() => {
        const active = overlay.querySelector('.am-form.am-active input');
        if (active) active.focus();
      }, 220);
    }
  }

  function close() {
    const overlay = document.getElementById('auth-modal-overlay');
    if (overlay) overlay.classList.remove('am-open');
  }

  // Initialise once DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject);
  } else {
    inject();
  }

  window.AuthModal = { open, close, redirectTo: '/hub.html', onSuccess: null };
})();
