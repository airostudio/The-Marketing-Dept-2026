/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * SCOTTY INTAKE — Audema - Your AI Marketing Department
 *
 * Included on every specialist agent page. On load, checks whether Scotty
 * dispatched a task to this agent. If so:
 *   1. Shows a "Dispatched by Scotty" banner with the task
 *   2. Pre-populates the primary input (marked with data-scotty-intake="primary")
 *   3. Stores the Scotty context so the agent's buildSystemPrompt can use it
 *
 * Dispatch payload shape (set by ScottyOrchestrator.dispatch):
 *   {
 *     agentKey:      string,   // e.g. 'seo'
 *     task:          string,   // the pre-filled task text
 *     scottyContext: string,   // Scotty's strategic framing
 *     userRequest:   string,   // the original user message to Scotty
 *     timestamp:     number
 *   }
 * ═══════════════════════════════════════════════════════════════════════════════
 */

(function () {
  'use strict';

  const DISPATCH_KEY = 'scotty_dispatch';
  const CONTEXT_KEY  = 'scotty_active_context';

  function init() {
    const raw = localStorage.getItem(DISPATCH_KEY);
    if (!raw) return;

    let dispatch;
    try { dispatch = JSON.parse(raw); } catch (e) { return; }

    // Stale dispatches (> 10 min) are ignored
    if (Date.now() - dispatch.timestamp > 10 * 60 * 1000) {
      localStorage.removeItem(DISPATCH_KEY);
      return;
    }

    // Consume immediately so refresh doesn't re-trigger
    localStorage.removeItem(DISPATCH_KEY);

    // Persist context for the agent's system prompt to read
    localStorage.setItem(CONTEXT_KEY, JSON.stringify({
      scottyContext: dispatch.scottyContext,
      userRequest:   dispatch.userRequest,
      agentKey:      dispatch.agentKey,
      timestamp:     dispatch.timestamp,
    }));

    // Wait for DOM to be ready before injecting
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => inject(dispatch));
    } else {
      inject(dispatch);
    }
  }

  function inject(dispatch) {
    injectBanner(dispatch);
    prefillInput(dispatch.task);
  }

  function injectBanner(dispatch) {
    const banner = document.createElement('div');
    banner.id = 'scotty-dispatch-banner';
    banner.style.cssText = [
      'position:fixed',
      'top:0',
      'left:0',
      'right:0',
      'z-index:9999',
      'background:linear-gradient(90deg,#7c3aed,#ec4899)',
      'color:#fff',
      'font-family:Inter,sans-serif',
      'font-size:13px',
      'font-weight:500',
      'padding:10px 20px',
      'display:flex',
      'align-items:center',
      'gap:12px',
      'box-shadow:0 2px 16px rgba(124,58,237,0.4)',
    ].join(';');

    const taskPreview = dispatch.task
      ? dispatch.task.slice(0, 120) + (dispatch.task.length > 120 ? '…' : '')
      : dispatch.userRequest.slice(0, 120);

    banner.innerHTML = `
      <span style="font-size:16px;flex-shrink:0;">🤖</span>
      <span style="flex:1;min-width:0;">
        <strong>Scotty dispatched this task:</strong>
        <span style="opacity:0.9;margin-left:6px;">${escapeHtml(taskPreview)}</span>
      </span>
      <a href="/scotty.html" style="color:#fff;opacity:0.8;font-size:12px;white-space:nowrap;text-decoration:none;border:1px solid rgba(255,255,255,0.3);padding:4px 10px;border-radius:20px;flex-shrink:0;">← Back to Scotty</a>
      <button onclick="document.getElementById('scotty-dispatch-banner').remove()" style="background:none;border:none;color:#fff;opacity:0.6;cursor:pointer;font-size:18px;line-height:1;flex-shrink:0;padding:0 4px;" title="Dismiss">×</button>
    `;

    document.body.prepend(banner);

    // Nudge page content down so banner doesn't cover the topbar
    document.body.style.paddingTop = (parseInt(document.body.style.paddingTop) || 0) + 42 + 'px';

    // Auto-dismiss after 12 seconds
    setTimeout(() => {
      const el = document.getElementById('scotty-dispatch-banner');
      if (el) {
        el.style.transition = 'opacity 0.4s';
        el.style.opacity = '0';
        setTimeout(() => el.remove(), 400);
        document.body.style.paddingTop = '';
      }
    }, 12000);
  }

  function prefillInput(task) {
    if (!task) return;

    // Find the element marked as Scotty's primary intake point
    const primary = document.querySelector('[data-scotty-intake="primary"]');
    if (!primary) return;

    // Only fill if the field is still empty (don't overwrite user work)
    if (primary.tagName === 'TEXTAREA' || primary.tagName === 'INPUT') {
      if (!primary.value.trim()) {
        primary.value = task;
        primary.dispatchEvent(new Event('input', { bubbles: true }));
        primary.focus();
        // Scroll the field into view
        setTimeout(() => primary.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300);
      }
    }
  }

  function escapeHtml(str) {
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  /**
   * Public API — agents can call this to get the Scotty context string
   * to append to their own system prompts.
   * @returns {string|null}
   */
  function getScottyContext() {
    try {
      const raw = localStorage.getItem(CONTEXT_KEY);
      if (!raw) return null;
      const ctx = JSON.parse(raw);
      // Context expires after the session (24h)
      if (Date.now() - ctx.timestamp > 24 * 60 * 60 * 1000) {
        localStorage.removeItem(CONTEXT_KEY);
        return null;
      }
      if (!ctx.scottyContext) return null;
      return `\n\n## SCOTTY'S STRATEGIC BRIEF\n${ctx.scottyContext}`;
    } catch (e) {
      return null;
    }
  }

  init();

  window.ScottyIntake = { getScottyContext };
})();
