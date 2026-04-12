/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * EMAIL VERIFICATION SERVICE
 * Client-side wrapper for /api/verify-email.
 * Caches results in localStorage to avoid duplicate API calls.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const EmailVerificationService = (() => {
  'use strict';

  const CACHE_KEY    = 'email_verification_cache';
  const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

  /* ── Cache helpers ─────────────────────────────────────────────────────── */

  function loadCache() {
    try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); }
    catch (_) { return {}; }
  }

  function saveCache(cache) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); }
    catch (_) { /* storage full — ignore */ }
  }

  function getCached(email) {
    const cache = loadCache();
    const entry = cache[email.toLowerCase()];
    if (!entry) return null;
    if (Date.now() - entry.ts > CACHE_TTL_MS) return null; // expired
    return entry.data;
  }

  function setCache(email, data) {
    const cache = loadCache();
    cache[email.toLowerCase()] = { ts: Date.now(), data };
    saveCache(cache);
  }

  /* ── Core verify ────────────────────────────────────────────────────────── */

  /**
   * Verify a single email address.
   * Returns cached result if available and fresh.
   *
   * @param {string} email
   * @returns {Promise<{email, result, score, disposable, webmail, reason, source}>}
   */
  async function verify(email) {
    if (!email || !email.trim()) {
      return { email: '', result: 'undeliverable', score: 0, reason: 'No email provided', disposable: false, webmail: false, source: 'built-in' };
    }

    const trimmed = email.trim().toLowerCase();
    const cached  = getCached(trimmed);
    if (cached) return { ...cached, fromCache: true };

    const response = await fetch('/api/verify-email', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email: trimmed }),
    });

    if (!response.ok) throw new Error(`Verification API error ${response.status}`);
    const data = await response.json();
    setCache(trimmed, data);
    return data;
  }

  /* ── UI helpers ─────────────────────────────────────────────────────────── */

  const RESULT_CONFIG = {
    deliverable:   { color: '#10b981', bg: 'rgba(16,185,129,0.12)',  border: 'rgba(16,185,129,0.3)',  icon: '✅', label: 'Deliverable'   },
    risky:         { color: '#f59e0b', bg: 'rgba(245,158,11,0.12)',  border: 'rgba(245,158,11,0.3)',  icon: '⚠️', label: 'Risky'         },
    undeliverable: { color: '#ef4444', bg: 'rgba(239,68,68,0.12)',   border: 'rgba(239,68,68,0.3)',   icon: '❌', label: 'Undeliverable' },
    unknown:       { color: '#94a3b8', bg: 'rgba(148,163,184,0.12)', border: 'rgba(148,163,184,0.3)', icon: '❓', label: 'Unknown'       },
  };

  /**
   * Return an HTML badge string for a verification result.
   * @param {Object} data — result from verify()
   * @returns {string} HTML
   */
  function getBadgeHTML(data) {
    const cfg = RESULT_CONFIG[data.result] || RESULT_CONFIG.unknown;
    const extras = [
      data.disposable ? '<span style="margin-left:6px;font-size:10px;color:#ef4444;">disposable</span>' : '',
      data.webmail    ? '<span style="margin-left:6px;font-size:10px;color:#f59e0b;">webmail</span>'    : '',
      data.source !== 'hunter' && data.source !== 'zerobounce'
        ? '<span style="margin-left:6px;font-size:10px;color:rgba(255,255,255,0.3);">built-in check</span>'
        : `<span style="margin-left:6px;font-size:10px;color:rgba(255,255,255,0.3);">${data.source} · score ${data.score}</span>`,
    ].join('');

    return `<span style="display:inline-flex;align-items:center;padding:4px 10px;background:${cfg.bg};border:1px solid ${cfg.border};border-radius:20px;font-size:12px;font-weight:600;color:${cfg.color};">
      ${cfg.icon} ${cfg.label}${extras}
    </span>`;
  }

  /**
   * Inject a verify button next to an email input and handle the full flow.
   *
   * @param {string}   inputId    — id of the <input type="email"> element
   * @param {string}   badgeId    — id of the element where the badge will be rendered
   * @param {Function} [onChange] — called with the result when verification completes
   */
  function attachVerifyButton(inputId, badgeId, onChange) {
    const input = document.getElementById(inputId);
    const badge = document.getElementById(badgeId);
    if (!input || !badge) return;

    // Render verify button
    let btn = document.getElementById(`${inputId}_verifyBtn`);
    if (!btn) {
      btn = document.createElement('button');
      btn.type      = 'button';
      btn.id        = `${inputId}_verifyBtn`;
      btn.textContent = 'Verify';
      btn.style.cssText = 'margin-left:8px;padding:6px 12px;background:rgba(6,182,212,0.12);border:1px solid rgba(6,182,212,0.3);border-radius:7px;color:#06b6d4;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;white-space:nowrap;';
      input.parentNode.style.display = 'flex';
      input.parentNode.style.alignItems = 'center';
      input.parentNode.appendChild(btn);
    }

    btn.addEventListener('click', async () => {
      const email = input.value.trim();
      if (!email) { badge.innerHTML = '<em style="font-size:12px;color:rgba(255,255,255,0.4);">Enter an email first.</em>'; return; }

      btn.textContent  = 'Checking…';
      btn.disabled     = true;
      badge.innerHTML  = '';

      try {
        const result    = await verify(email);
        badge.innerHTML = getBadgeHTML(result);
        badge.title     = result.reason || '';
        if (onChange) onChange(result);
      } catch (err) {
        badge.innerHTML = '<em style="font-size:12px;color:#ef4444;">Verification failed — check API config.</em>';
      } finally {
        btn.textContent = 'Re-verify';
        btn.disabled    = false;
      }
    });
  }

  return { verify, getBadgeHTML, attachVerifyButton, RESULT_CONFIG };
})();

window.EmailVerificationService = EmailVerificationService;
