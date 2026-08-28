/**
 * AUTH MODAL — Audema
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

  async function _getSupabaseConfig(forceServerRefresh) {
    if (!forceServerRefresh && _sbConfig !== null) return _sbConfig;

    if (!forceServerRefresh) {
      // Also check if supabase-client.js already has valid config in APP_CONFIG
      var ac = window.APP_CONFIG || {};
      if (ac.SUPABASE_URL && ac.SUPABASE_ANON_KEY) {
        _sbConfig = { supabaseUrl: ac.SUPABASE_URL, supabaseKey: ac.SUPABASE_ANON_KEY, configured: true };
        return _sbConfig;
      }
      // Fall back to localStorage keys (set via Settings page) — skipped on
      // a forced refresh, since a stale/wrong cached value here is exactly
      // what a forced refresh is trying to route around.
      var lsUrl = localStorage.getItem('supabase-url');
      var lsKey = localStorage.getItem('supabase-anon-key');
      if (lsUrl && lsKey) {
        _sbConfig = { supabaseUrl: lsUrl, supabaseKey: lsKey, configured: true };
        return _sbConfig;
      }
    }
    // Fetch from Vercel env vars via API — the authoritative source
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

  function _isNetworkFailure(err) {
    // A raw "Failed to fetch" / "NetworkError" TypeError means the request
    // never got a response at all (bad URL, DNS failure, CSP block) — as
    // opposed to a resolved-but-unsuccessful auth response, which _sbLogin/
    // _sbSignup turn into a regular Error with a real message.
    return err && err.name === 'TypeError' && /fetch|network/i.test(err.message || '');
  }

  function _clearStaleSupabaseConfigCache() {
    try {
      localStorage.removeItem('supabase-url');
      localStorage.removeItem('supabase-anon-key');
    } catch (e) { /* ignore */ }
  }

  // ── Supabase Auth REST (no SDK needed) ───────────────────────────────────

  // Supabase's Auth (GoTrue) API is inconsistent about which field the
  // actual error text is on depending on the error and server version —
  // `msg` for most classic errors ("User already registered", "Signups not
  // allowed for this instance", password-policy rejections, rate limits),
  // `error_description` for OAuth-style errors, occasionally a plain
  // `error` string. Checking only error_description/message (as this used
  // to) missed `msg` — the single most common field — so the real reason
  // Supabase rejected the request was silently discarded and replaced with
  // a useless generic "Sign up failed." on every one of those cases. This
  // is the actual fix for that: surface whatever real text the API sent
  // before falling back to the generic message.
  function _supabaseErrorText(d, fallback) {
    if (!d) return fallback;
    return d.error_description || d.msg || d.message || (typeof d.error === 'string' ? d.error : d.error?.message) || fallback;
  }

  async function _sbLogin(email, password, cfg) {
    var r = await fetch(`${cfg.supabaseUrl}/auth/v1/token?grant_type=password`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': cfg.supabaseKey },
      body:    JSON.stringify({ email, password }),
      signal:  AbortSignal.timeout(10000),
    });
    var d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(_supabaseErrorText(d, `Login failed (HTTP ${r.status}).`));
    return d; // { access_token, refresh_token, user: { id, email, user_metadata } }
  }

  async function _sbSignup(email, password, firstname, lastname, org, cfg) {
    var r = await fetch(`${cfg.supabaseUrl}/auth/v1/signup`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': cfg.supabaseKey },
      body:    JSON.stringify({ email, password, data: { firstname, lastname, org } }),
      signal:  AbortSignal.timeout(10000),
    });
    // A non-JSON body (an HTML error page from a proxy/WAF/5xx, a blocked
    // request) used to throw an opaque SyntaxError out of r.json() that
    // never reached the caller's own error handling — .catch(() => ({}))
    // here means that case now falls through to the HTTP-status fallback
    // message below instead of a raw parse error.
    var d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(_supabaseErrorText(d, `Sign up failed (HTTP ${r.status}).`));
    // Some Supabase configs require email confirmation — if no access_token yet, still succeed.
    // This is the actual bug that was hiding behind "Sign up failed — the
    // server returned an unexpected response": when email confirmation IS
    // required, GoTrue's signup response is the raw user object AT THE TOP
    // LEVEL — {id, email, confirmation_sent_at, ...} — not nested under
    // d.user. A signup that genuinely succeeded (account created,
    // confirmation email sent) was being treated as a failure purely
    // because this only ever checked d.user, never a bare d.id. authSignup()
    // already handles "no access_token" correctly by showing a
    // check-your-email message — it just needs this to actually return
    // instead of throwing first.
    if (!d.access_token && !d.user && !d.id) throw new Error(_supabaseErrorText(d, 'Sign up failed — the server returned an unexpected response.'));
    return d;
  }

  // ── DB persistence safety net ─────────────────────────────────────────────
  // The organization name entered at sign-up is always saved into Supabase
  // auth.users.raw_user_meta_data immediately (that write can never fail
  // silently — it's part of the signup call itself). This best-effort call
  // additionally mirrors it into the queryable public.profiles.company
  // column, so it works even on databases where the handle_new_user()
  // trigger hasn't been re-run yet. Never blocks or throws on the caller.
  async function _syncProfileCompany(cfg, accessToken, userId, company) {
    if (!company || !accessToken || !userId) return;
    try {
      await fetch(`${cfg.supabaseUrl}/rest/v1/profiles?id=eq.${userId}`, {
        method:  'PATCH',
        headers: {
          'Content-Type':  'application/json',
          'apikey':        cfg.supabaseKey,
          'Authorization': `Bearer ${accessToken}`,
          'Prefer':        'return=minimal',
        },
        body:   JSON.stringify({ company }),
        signal: AbortSignal.timeout(6000),
      });
    } catch (_) { /* best-effort only — org is already safe in auth metadata */ }
  }

  // ── Cross-account data isolation guard ────────────────────────────────────
  // This modal is the primary login path on index.html and talks to Supabase
  // via raw fetch — it never goes through the supabase-js SDK client, so
  // supabase-client.js's own onAuthStateChange-based guard never fires for
  // logins/logouts made here. Business Brain / Intelligence Layer data lives
  // in localStorage keyed by *active profile*, not by user id, so without
  // this a second person signing in on the same browser inherits whatever
  // business data the previous account left behind. Shares the same
  // 'audema_last_uid' tracker key as supabase-client.js's guard so both
  // login paths cooperate on one browser-wide account-switch signal.
  var LAST_UID_KEY = 'audema_last_uid';

  // ownerUserId lets clearAll() back the Business Brain up before wiping it,
  // namespaced to that user — without it a sign-out permanently destroys any
  // brain data that never reached the cloud. Falls back to the last known
  // uid (still set at every call site below), which owns the data being cleared.
  function _clearLocalIntelligenceState(ownerUserId) {
    var uid = ownerUserId;
    if (!uid) { try { uid = localStorage.getItem(LAST_UID_KEY); } catch (e) { uid = null; } }
    try {
      if (window.IntelligenceEngine?.clearAll) window.IntelligenceEngine.clearAll(true, uid);
    } catch (e) { console.error('[auth-modal] IntelligenceEngine.clearAll failed:', e); }
    try {
      localStorage.removeItem('intel_active_profile');
      localStorage.removeItem('seo-current-project');
    } catch (e) { console.error('[auth-modal] local cache cleanup failed:', e); }
  }

  function _guardAccountSwitch(userId) {
    if (!userId) return;
    var lastUid;
    try { lastUid = localStorage.getItem(LAST_UID_KEY); } catch (e) { return; }

    if (lastUid && lastUid !== userId) {
      console.warn('[auth-modal] Different account detected on this browser — clearing local intelligence/profile cache to prevent cross-account data bleed.');
      // Data being cleared belongs to lastUid — back it up under THAT id.
      _clearLocalIntelligenceState(lastUid);
    }
    try { localStorage.setItem(LAST_UID_KEY, userId); } catch (e) { /* ignore */ }

    // This user is signing back in — re-hydrate anything their own sign-out
    // backed up. Non-destructive: never overwrites a bucket that already has
    // live data, so a cloud pull or fresh edit always wins.
    try {
      if (window.IntelligenceEngine?.restoreBrainBackup) {
        window.IntelligenceEngine.restoreBrainBackup(userId);
      }
    } catch (e) { console.warn('[auth-modal] Business Brain backup restore failed:', e && e.message); }
  }

  // ── Bridge into the Supabase SDK client ───────────────────────────────────
  // This modal logs in via raw fetch() against Supabase's Auth REST API, not
  // the supabase-js SDK — so without this, the SDK client that every Store
  // module (Nancy, SEO pipeline, Analytics, Contacts, ...) reads auth state
  // from never learns a login happened here. It keeps its own persisted
  // session (or none at all) under its own localStorage key, completely out
  // of sync with what this modal thinks is true. That mismatch — not a
  // session actually expiring — is what made pages built on those Store
  // modules intermittently claim "not logged in" right after a real,
  // successful login. auth.setSession() hands the SDK the real tokens so it
  // persists and auto-refreshes them like any session it created itself.
  async function _syncSdkSession(sbData) {
    if (!window.Supabase || !sbData || !sbData.access_token || !sbData.refresh_token) return;
    try {
      if (window.Supabase.ready) await window.Supabase.ready();
      var client = window.Supabase.getClient && window.Supabase.getClient();
      if (!client && _sbConfig && _sbConfig.configured && window.Supabase.init) {
        await window.Supabase.init(_sbConfig.supabaseUrl, _sbConfig.supabaseKey);
        client = window.Supabase.getClient && window.Supabase.getClient();
      }
      if (client) {
        await client.auth.setSession({ access_token: sbData.access_token, refresh_token: sbData.refresh_token });
      }
    } catch (e) {
      console.warn('[auth-modal] Failed to sync session into Supabase SDK client:', e && e.message);
    }
  }

  // ── Session helpers ───────────────────────────────────────────────────────
  async function _createSessionFromSupabase(sbData) {
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

    if (pub.org && pub.id && _sbConfig) {
      _syncProfileCompany(_sbConfig, accessToken, pub.id, pub.org);
    }

    // Must happen before returning — every Store module's auth check reads
    // through the SDK client, not this modal's own localStorage keys below.
    await _syncSdkSession(sbData);

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
    _guardAccountSwitch(pub.id);
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
    _guardAccountSwitch(pub.id);
    return pub;
  }

  // ── Auth entry points ─────────────────────────────────────────────────────
  async function authLogin(email, password) {
    var cfg = await _getSupabaseConfig();
    if (cfg && cfg.configured) {
      try {
        var data = await _sbLogin(email, password, cfg);
        return _createSessionFromSupabase(data);
      } catch (err) {
        // A supabase-url/supabase-anon-key pair cached in this browser's
        // localStorage (from an old Settings entry, or a previous deploy
        // that had it configured) is trusted ahead of the live server
        // config and never self-clears — if it's gone stale, every login
        // fails at the network/DNS level with a bare "Failed to fetch" no
        // matter how correct the server-side config now is. Re-check the
        // authoritative config before giving up.
        if (_isNetworkFailure(err)) {
          var fresh = await _getSupabaseConfig(true);
          if (fresh && fresh.configured && (fresh.supabaseUrl !== cfg.supabaseUrl || fresh.supabaseKey !== cfg.supabaseKey)) {
            var data2 = await _sbLogin(email, password, fresh);
            return _createSessionFromSupabase(data2);
          }
          if (!fresh || !fresh.configured) {
            // The server itself says Supabase isn't configured at all —
            // the cached pair isn't just outdated, it's pointing at
            // something that no longer exists server-side. Drop it and
            // fall through to local-only auth below instead of surfacing
            // a raw "Failed to fetch" for a URL that was never going to work.
            _clearStaleSupabaseConfigCache();
            cfg = fresh;
          } else {
            throw err;
          }
        } else {
          throw err;
        }
      }
    }
    if (!cfg || !cfg.configured) {
      // Fallback: localStorage-only (single browser)
      var users = _getUsers();
      var user  = users.find(u => u.email.toLowerCase() === email.toLowerCase());
      if (!user) throw new Error('No account found. Please create an account first.');
      if (user.password !== _hash(password)) throw new Error('Incorrect password.');
      return _createSessionLocal(user);
    }
  }

  // Returns the public user object on a full session, or
  // { needsEmailConfirmation: true } when the account was created but
  // needs email confirmation before it can sign in — that is a SUCCESS
  // outcome and must never be thrown as an Error: handleSignup()'s catch
  // block renders any thrown error in the red failure box, which would
  // tell a user whose signup just genuinely succeeded that it failed.
  async function authSignup(email, password, firstname, lastname, org) {
    var cfg = await _getSupabaseConfig();
    if (cfg && cfg.configured) {
      var data;
      try {
        data = await _sbSignup(email, password, firstname, lastname, org, cfg);
      } catch (err) {
        if (_isNetworkFailure(err)) {
          var fresh = await _getSupabaseConfig(true);
          if (fresh && fresh.configured && (fresh.supabaseUrl !== cfg.supabaseUrl || fresh.supabaseKey !== cfg.supabaseKey)) {
            data = await _sbSignup(email, password, firstname, lastname, org, fresh);
          } else if (!fresh || !fresh.configured) {
            _clearStaleSupabaseConfigCache();
            cfg = fresh; // falsy — falls through to the local fallback below
          } else {
            throw err;
          }
        } else {
          throw err;
        }
      }
      if (data) {
        if (data.access_token) return _createSessionFromSupabase(data);
        return { needsEmailConfirmation: true };
      }
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
      background: rgba(4,4,10,0.86);
      backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
      z-index: 99999;
      display: flex; align-items: center; justify-content: center; padding: 20px;
      opacity: 0; pointer-events: none; transition: opacity 0.22s ease;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
    }
    #auth-modal-overlay.am-open { opacity: 1; pointer-events: all; }
    #auth-modal-box {
      background: #0d0d16;
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 18px;
      box-shadow: 0 32px 90px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.03) inset;
      width: 100%; max-width: 440px; overflow: hidden;
      transform: translateY(18px) scale(0.97); transition: transform 0.22s ease;
    }
    #auth-modal-overlay.am-open #auth-modal-box { transform: translateY(0) scale(1); }
    .am-header {
      background: linear-gradient(135deg, #7c3aed, #ec4899);
      color: #fff; padding: 30px 32px 26px; text-align: center; position: relative;
    }
    .am-header h2 { font-size: 24px; font-weight: 800; margin-bottom: 4px; font-family: inherit; letter-spacing: -0.01em; }
    .am-header p  { opacity: 0.9; font-size: 13px; font-family: inherit; }
    .am-close {
      position: absolute; top: 14px; right: 16px;
      background: rgba(255,255,255,0.16); border: none; border-radius: 50%;
      width: 30px; height: 30px; font-size: 17px; line-height: 1; cursor: pointer;
      color: #fff; display: flex; align-items: center; justify-content: center;
      transition: background 0.15s; font-family: inherit;
    }
    .am-close:hover { background: rgba(255,255,255,0.28); }
    .am-tabs { display: flex; border-bottom: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.02); }
    .am-tab {
      flex: 1; padding: 14px; text-align: center; background: none; border: none;
      border-bottom: 2px solid transparent; cursor: pointer;
      font-size: 14px; font-weight: 600; color: rgba(255,255,255,0.45);
      transition: all 0.18s; font-family: inherit;
    }
    .am-tab:hover:not(.am-active) { color: rgba(255,255,255,0.7); }
    .am-tab.am-active { color: #c4b5fd; border-bottom-color: #a78bfa; }
    .am-body { padding: 28px 32px 26px; }
    .am-alert {
      padding: 11px 14px; border-radius: 8px; margin-bottom: 18px;
      font-size: 13px; display: none; font-family: inherit; line-height: 1.5;
    }
    .am-alert.am-show { display: block; }
    .am-alert.am-error   { background: rgba(239,68,68,0.1); color: #f87171; border: 1px solid rgba(239,68,68,0.25); }
    .am-alert.am-success { background: rgba(16,185,129,0.1); color: #34d399; border: 1px solid rgba(16,185,129,0.25); }
    .am-form { display: none; }
    .am-form.am-active { display: block; }
    .am-field { margin-bottom: 16px; }
    .am-field label {
      display: block; margin-bottom: 6px;
      font-size: 12px; font-weight: 600; color: rgba(255,255,255,0.5);
      text-transform: uppercase; letter-spacing: 0.05em; font-family: inherit;
    }
    .am-field input {
      width: 100%; padding: 11px 14px;
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.12); border-radius: 9px;
      font-size: 14px; font-family: inherit; color: #f1f5f9;
      transition: border-color 0.18s, box-shadow 0.18s, background 0.18s;
      outline: none; box-sizing: border-box;
    }
    .am-field input::placeholder { color: rgba(255,255,255,0.25); }
    .am-field input:focus {
      border-color: #a78bfa; background: rgba(124,58,237,0.08);
      box-shadow: 0 0 0 3px rgba(124,58,237,0.15);
    }
    .am-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .am-submit {
      width: 100%; padding: 13px;
      background: linear-gradient(135deg, #7c3aed, #ec4899);
      color: #fff; border: none; border-radius: 9px;
      font-size: 14px; font-weight: 700; cursor: pointer; font-family: inherit;
      transition: transform 0.15s, box-shadow 0.15s, opacity 0.15s;
      display: flex; align-items: center; justify-content: center; gap: 8px;
      margin-top: 4px;
    }
    .am-submit:hover  { transform: translateY(-1px); box-shadow: 0 8px 22px rgba(124,58,237,0.4); }
    .am-submit:active { transform: translateY(0); box-shadow: none; }
    .am-submit:disabled { opacity: 0.55; cursor: not-allowed; transform: none; box-shadow: none; }
    .am-spinner {
      display: inline-block; width: 14px; height: 14px;
      border: 2px solid rgba(255,255,255,0.4); border-top-color: #fff;
      border-radius: 50%; animation: am-spin 0.7s linear infinite;
    }
    @keyframes am-spin { to { transform: rotate(360deg); } }
    .am-note {
      margin-top: 18px; padding: 10px 12px; background: rgba(255,255,255,0.03);
      border: 1px solid rgba(255,255,255,0.06);
      border-radius: 8px; font-size: 11.5px; color: rgba(255,255,255,0.4);
      text-align: center; font-family: inherit; letter-spacing: 0.01em;
    }
    @media (max-width: 480px) {
      #auth-modal-box { border-radius: 14px; }
      .am-body { padding: 22px 20px; }
      .am-header { padding: 24px 20px 20px; }
      .am-row { grid-template-columns: 1fr; gap: 0; }
    }
  `;

  /* ─── HTML ────────────────────────────────────────────────────────────── */

  const HTML = `
    <div id="auth-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="am-title">
      <div id="auth-modal-box">
        <div class="am-header">
          <h2 id="am-title">Audema</h2>
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
      var result = await authSignup(email, pwd, first, last, org);
      if (result && result.needsEmailConfirmation) {
        showSuccess('Account created — check your email to confirm it, then sign in.');
        resetBtn(btn, 'Create Account');
        return;
      }
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
    // Best-effort, fire-and-forget — sign the SDK client out too, or the
    // session _syncSdkSession() planted survives this "logout" and every
    // Store-module page still thinks the previous account is signed in.
    try {
      var c = window.Supabase && window.Supabase.getClient && window.Supabase.getClient();
      if (c) c.auth.signOut().catch(function () {});
    } catch (e) { /* ignore */ }

    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('user');
    localStorage.removeItem('seo_agent_user');
    localStorage.removeItem('seo_agent_session');
    _sbConfig = null; // Reset cache so next login re-checks
    // Clear immediately — don't wait for the next login to detect the
    // account switch, in case this browser gets handed straight to someone
    // else without them logging in through this same modal path.
    _clearLocalIntelligenceState();
    try { localStorage.removeItem(LAST_UID_KEY); } catch (e) { /* ignore */ }
  }

  // One-time migration for sessions created before the SDK-sync fix above
  // existed: this modal's own bookkeeping (aduma_session/access_token/
  // refresh_token) says signed in, but since _syncSdkSession() didn't exist
  // yet when that login happened, the SDK client never got the tokens and
  // every Store-module page still shows "not logged in". Re-plant them into
  // the SDK client once, using the tokens this modal already has — no
  // re-login required. Safe to run every page load: setSession() is a no-op
  // once the SDK already has this same session persisted.
  async function _migrateExistingSessionToSdk() {
    if (!isLoggedIn()) return;
    var accessToken  = localStorage.getItem('access_token');
    var refreshToken = localStorage.getItem('refresh_token');
    if (!accessToken || !refreshToken || accessToken.indexOf('local_') === 0) return; // local-only session, nothing to bridge
    try {
      if (window.Supabase && window.Supabase.ready) await window.Supabase.ready();
      var client = window.Supabase && window.Supabase.getClient && window.Supabase.getClient();
      if (!client) return; // not configured — nothing to sync into
      var existing = await client.auth.getSession();
      if (existing && existing.data && existing.data.session) return; // SDK already has a session
      await _syncSdkSession({ access_token: accessToken, refresh_token: refreshToken });
    } catch (e) { /* best-effort only */ }
  }

  // Wire up the already-exposed AuthModal
  _open  = openModal;
  _close = closeModal;
  window.AuthModal.isLoggedIn = isLoggedIn;
  window.AuthModal.logout     = authLogout;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { inject(); checkUrlParam(); _migrateExistingSessionToSdk(); });
  } else {
    inject();
    checkUrlParam();
    _migrateExistingSessionToSdk();
  }

})();
