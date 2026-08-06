/**
 * SiteSwitcher — global "which client/site am I working on right now" widget.
 *
 * Mounts into any page via <div id="site-switcher-mount"></div> in the nav,
 * plus a call to SiteSwitcher.mount(). Self-contained: injects its own CSS
 * so it looks consistent regardless of which page's design system it's
 * dropped into.
 *
 * Uses IntelligenceProfiles (web/js/intelligence-profiles.js) as the
 * canonical multi-site scope — this is the one mechanism BusinessBrain,
 * ContactsStore, and SocialPostsStore already key off (see each store's
 * _key()/getScope(), which all check 'intel_active_profile' first), so
 * switching here moves the Business Brain, Audience Manager, Social Studio,
 * Pat, Sales Intelligence, and LinkedIn Outreach pages together in one
 * action. It intentionally does NOT touch the separate 'seo-current-project'
 * scope the SEO dashboard uses — that's a different, unreconciled concept;
 * see VERCEL_SETUP.md for the full picture.
 */
window.SiteSwitcher = (function () {
  'use strict';

  let profiles = [];
  let activeId = null;
  let stylesInjected = false;

  function escHtml(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;
    const style = document.createElement('style');
    style.textContent = `
      .site-switcher { position: relative; font-family: 'Inter', sans-serif; }
      .site-switcher-btn {
        display: flex; align-items: center; gap: 7px;
        padding: 6px 12px; background: rgba(255,255,255,0.05);
        border: 1px solid rgba(255,255,255,0.12); border-radius: 8px;
        color: #fff; font-size: 13px; font-weight: 600; cursor: pointer;
        font-family: inherit; max-width: 200px;
      }
      .site-switcher-btn:hover { background: rgba(255,255,255,0.09); }
      .site-switcher-dot { width: 7px; height: 7px; border-radius: 50%; background: #10b981; flex-shrink: 0; }
      #siteSwitcherLabel { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .site-switcher-caret { font-size: 10px; opacity: 0.6; flex-shrink: 0; }
      .site-switcher-menu {
        display: none; position: absolute; top: calc(100% + 6px); right: 0;
        min-width: 220px; max-width: 320px; max-height: 360px; overflow-y: auto;
        background: #13131f; border: 1px solid rgba(255,255,255,0.12);
        border-radius: 10px; box-shadow: 0 12px 32px rgba(0,0,0,0.45); z-index: 1000;
        padding: 6px;
      }
      .site-switcher-menu.open { display: block; }
      .site-switcher-item {
        display: flex; align-items: center; justify-content: space-between; gap: 8px;
        padding: 9px 10px; border-radius: 7px; color: #e2e8f0; font-size: 13px;
        cursor: pointer; text-decoration: none;
      }
      .site-switcher-item:hover { background: rgba(255,255,255,0.07); }
      .site-switcher-item.active { color: #34d399; font-weight: 600; }
      .site-switcher-check { color: #34d399; }
      .site-switcher-item.add { color: #a78bfa; font-weight: 600; }
      .site-switcher-item.manage { color: rgba(255,255,255,0.5); font-size: 12px; }
      .site-switcher-divider { height: 1px; background: rgba(255,255,255,0.08); margin: 5px 2px; }
    `;
    document.head.appendChild(style);
  }

  async function mount(containerId) {
    injectStyles();
    const container = document.getElementById(containerId || 'site-switcher-mount');
    if (!container || !window.IntelligenceProfiles) return;

    container.innerHTML = `<div class="site-switcher" id="siteSwitcherRoot">
      <button type="button" class="site-switcher-btn" id="siteSwitcherBtn" onclick="SiteSwitcher.toggle()" title="Switch which client/site you're marketing">
        <span class="site-switcher-dot"></span>
        <span id="siteSwitcherLabel">Loading…</span>
        <span class="site-switcher-caret">▾</span>
      </button>
      <div class="site-switcher-menu" id="siteSwitcherMenu"></div>
    </div>`;

    await refresh();
  }

  async function refresh() {
    if (!window.IntelligenceProfiles) return;
    let result;
    try {
      result = await window.IntelligenceProfiles.ensureActiveProfile();
    } catch (e) {
      result = null;
    }

    const root = document.getElementById('siteSwitcherRoot');
    if (!result) {
      // Not signed in / offline — hide rather than show a broken control.
      if (root) root.style.display = 'none';
      return;
    }
    if (root) root.style.display = '';

    profiles = result.profiles;
    activeId = result.active?.id;
    render();
  }

  function render() {
    const label = document.getElementById('siteSwitcherLabel');
    const menu = document.getElementById('siteSwitcherMenu');
    if (!label || !menu) return;

    const active = profiles.find(p => p.id === activeId);
    label.textContent = active ? (active.business_name || active.name) : 'Select a site';

    const items = profiles.map(p => `
      <div class="site-switcher-item ${p.id === activeId ? 'active' : ''}" onclick="SiteSwitcher.select('${p.id}')">
        <span>${escHtml(p.business_name || p.name)}</span>
        ${p.id === activeId ? '<span class="site-switcher-check">✓</span>' : ''}
      </div>
    `).join('');

    menu.innerHTML = items
      + `<div class="site-switcher-divider"></div>`
      + `<div class="site-switcher-item add" onclick="SiteSwitcher.addNew()">+ Add New Site</div>`
      + `<a class="site-switcher-item manage" href="/intelligence/business-brain.html">⚙ Manage Sites</a>`;
  }

  function toggle() {
    const menu = document.getElementById('siteSwitcherMenu');
    if (menu) menu.classList.toggle('open');
  }

  function close() {
    const menu = document.getElementById('siteSwitcherMenu');
    if (menu) menu.classList.remove('open');
  }

  function select(profileId) {
    close();
    if (profileId === activeId) return;
    window.IntelligenceProfiles.setActiveProfile(profileId);
    // A full reload is the simplest reliable way to make every store on the
    // page re-scope — most compute their storage key from localStorage at
    // call time, but pages that already loaded data into JS state (contact
    // lists, calendars, pipelines) won't otherwise refresh.
    location.reload();
  }

  async function addNew() {
    const info = await window.IntelligenceProfiles.getPlanInfo();
    if (info.used >= info.limit) {
      alert(`Site limit reached (${info.used} of ${info.limit} on the ${info.plan} plan). Upgrade to add more, or manage existing sites at Business Brain → ⚙ Profiles.`);
      return;
    }
    const name = prompt('Name this site/client (e.g. "Acme Corp" or "acme.com"):');
    if (!name || !name.trim()) return;
    try {
      const created = await window.IntelligenceProfiles.create(name.trim());
      window.IntelligenceProfiles.setActiveProfile(created.id);
      location.reload();
    } catch (e) {
      alert(e.message);
    }
  }

  // Close the menu on outside click.
  document.addEventListener('click', (e) => {
    const root = document.getElementById('siteSwitcherRoot');
    if (root && !root.contains(e.target)) close();
  });

  // Cross-tab sync — another tab switched sites, this one catches up.
  window.addEventListener('storage', (e) => {
    if (e.key === window.IntelligenceProfiles?.ACTIVE_KEY) location.reload();
  });

  return { mount, refresh, toggle, select, addNew };
})();
