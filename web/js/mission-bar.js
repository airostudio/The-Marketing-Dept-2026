/**
 * MissionBar — the novice's compass. A slim breadcrumb injected under the
 * nav on every page, showing progress through the active Scotty mission
 * (MissionStore.getActive()) so a user who left Scotty to go run an agent's
 * own page still knows "what am I doing right now, and what's next".
 *
 * Renders nothing when there's no active mission — zero cost for anyone not
 * using Scotty missions. Self-mounting: just add
 *   <script src="/js/mission-bar.js"></script>
 * after <nav> in a page's body; no container div or explicit mount() call
 * needed (unlike SiteSwitcher, which several agent pages already load).
 */
window.MissionBar = (function () {
  'use strict';

  const META = {
    seo: { icon: '🔍', name: 'SEO' }, content: { icon: '✍️', name: 'Content' },
    email: { icon: '📧', name: 'Email' }, ads: { icon: '🎨', name: 'Ads' },
    social: { icon: '📱', name: 'Social' }, cro: { icon: '🧪', name: 'CRO' },
    analytics: { icon: '📊', name: 'Analytics' }, sales: { icon: '🎯', name: 'Sales' },
    linkedin: { icon: '💼', name: 'LinkedIn' }, video: { icon: '🎬', name: 'Video' },
    compliance: { icon: '🛡️', name: 'Compliance' }, deck: { icon: '📽️', name: 'Deck' },
    'compliance-automation': { icon: '🔒', name: 'Enterprise Compliance' },
    competitive: { icon: '🕵️', name: 'Competitive' }, nancy: { icon: '📸', name: 'Instagram' },
    blade: { icon: '🗡️', name: 'Blade' }, email_delivery: { icon: '📬', name: 'Pat' },
  };

  function meta(agentKey) { return META[agentKey] || { icon: '🤖', name: agentKey }; }

  function escHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  function statusDot(status) {
    if (status === 'done') return '<span class="mb-dot mb-dot-done">●</span>';
    if (status === 'in_progress') return '<span class="mb-dot mb-dot-active">◐</span>';
    if (status === 'skipped') return '<span class="mb-dot mb-dot-skip">○</span>';
    return '<span class="mb-dot mb-dot-pending">○</span>';
  }

  function injectStyles() {
    if (document.getElementById('mission-bar-styles')) return;
    const style = document.createElement('style');
    style.id = 'mission-bar-styles';
    style.textContent = `
      .mission-bar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
        padding: 9px 24px; background: rgba(124,58,237,0.08); border-bottom: 1px solid rgba(124,58,237,0.2);
        font-family: 'Inter', sans-serif; font-size: 12.5px; }
      .mission-bar-goal { color: rgba(245,245,247,0.55); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 240px; }
      .mission-bar-steps { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
      .mb-step { display: inline-flex; align-items: center; gap: 5px; padding: 3px 9px; border-radius: 999px;
        background: rgba(255,255,255,0.05); color: rgba(245,245,247,0.75); white-space: nowrap; }
      .mb-step.mb-step-active { background: rgba(124,58,237,0.18); color: #fff; font-weight: 600; }
      .mb-dot-done { color: #34d399; } .mb-dot-active { color: #a78bfa; } .mb-dot-pending, .mb-dot-skip { color: rgba(245,245,247,0.3); }
      .mission-bar-arrow { color: rgba(245,245,247,0.25); font-size: 11px; }
      .mission-bar-back { margin-left: auto; color: #a78bfa; text-decoration: none; font-weight: 600; white-space: nowrap; }
      .mission-bar-back:hover { text-decoration: underline; }
    `;
    document.head.appendChild(style);
  }

  function render() {
    const mission = window.MissionStore ? window.MissionStore.getActive() : null;
    const existing = document.getElementById('mission-bar');
    if (!mission) { if (existing) existing.remove(); return; }

    injectStyles();
    let bar = existing;
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'mission-bar';
      bar.className = 'mission-bar';
      const nav = document.querySelector('nav');
      if (nav && nav.parentNode) nav.parentNode.insertBefore(bar, nav.nextSibling);
      else document.body.insertBefore(bar, document.body.firstChild);
    }

    const stepsHtml = mission.steps.map((s, i) => {
      const m = meta(s.agentKey);
      const active = s.status === 'in_progress';
      return (i > 0 ? '<span class="mission-bar-arrow">→</span>' : '') +
        `<span class="mb-step${active ? ' mb-step-active' : ''}">${statusDot(s.status)} ${m.icon} ${escHtml(m.name)}</span>`;
    }).join('');

    bar.innerHTML =
      `<span class="mission-bar-goal" title="${escHtml(mission.goal)}">🚀 ${escHtml(mission.goal || 'Mission in progress')}</span>` +
      `<span class="mission-bar-steps">${stepsHtml}</span>` +
      `<a class="mission-bar-back" href="/scotty.html">Back to Scotty →</a>`;
  }

  function init() {
    render();
    // Missions are updated via MissionStore from the current tab (same-tab
    // writes don't fire the 'storage' event) or another tab (which do) —
    // cover both: a light poll for same-tab step updates, plus the event
    // for cross-tab ones.
    window.addEventListener('storage', (e) => { if (e.key === 'audema_active_mission') render(); });
    setInterval(render, 4000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  return { render };
})();
