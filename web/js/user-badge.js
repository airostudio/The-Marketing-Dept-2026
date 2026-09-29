/**
 * UserBadge — fills the sidebar user menu from the account that is actually
 * signed in.
 *
 * Every page carrying that menu shipped a hardcoded label: settings.html said
 * "John Doe / Pro Plan", dashboard/alerts/cmo-dashboard/content-strategy said
 * "Free Plan", and nothing anywhere ever populated [data-metric="user-plan"].
 * So a free user was told they were on Pro, and a paying customer was told
 * they were on Free — the interface asserting a fact about the account that
 * it had never checked.
 *
 * This reads the real profile once and writes name, plan and initials. When
 * it cannot determine the plan it says so rather than substituting a
 * plausible-looking default, because a wrong plan label is worse than an
 * honest blank: it is the number a customer would use to decide whether they
 * are being billed correctly.
 *
 * Requires supabase-client.js (window.Supabase) and, ideally, auth.js.
 * Degrades quietly on pages where neither is present.
 */
window.UserBadge = (function () {
  'use strict';

  const PLAN_LABELS = {
    free: 'Free plan', start: 'Start plan', growth: 'Growth plan', scale: 'Scale plan',
    autonomous: 'Autonomous plan', enterprise: 'Enterprise plan',
    agency_starter: 'Agency Starter', agency_growth: 'Agency Growth',
    agency_pro: 'Agency Pro', agency_enterprise: 'Agency Enterprise',
  };

  function setAll(selectors, text) {
    if (text == null) return;
    selectors.forEach(sel => {
      document.querySelectorAll(sel).forEach(el => { el.textContent = text; });
    });
  }

  function initialsFrom(name, email) {
    const source = (name || '').trim();
    if (source) {
      const parts = source.split(/\s+/).filter(Boolean);
      const ini = parts.length >= 2 ? parts[0][0] + parts[1][0] : parts[0].slice(0, 2);
      return ini.toUpperCase();
    }
    if (email) return email.slice(0, 2).toUpperCase();
    return '';
  }

  async function mount() {
    let user = null, profile = null;

    // "There is no session" and "this page has no way to check" are different
    // states. On a page that never loads the auth modules we must not assert
    // either a name or a plan — that would just be a different wrong label in
    // place of the hardcoded one. Blank the plan (the actively misleading
    // part) and leave the rest alone.
    if (!window.Supabase && !window.Auth) {
      console.warn('[UserBadge] no auth modules on this page — cannot determine the account.');
      setAll(['[data-metric="user-plan"]', '.user-plan'], '');
      return;
    }

    try {
      if (window.Supabase?.ready) await window.Supabase.ready();
      user = window.Auth?.getUser ? await window.Auth.getUser() : null;
      if (user?.id && window.Supabase?.DB?.getProfile) {
        profile = await window.Supabase.DB.getProfile(user.id);
      }
    } catch (e) {
      console.warn('[UserBadge] could not read the signed-in account:', e.message);
    }

    if (!user) {
      // Signed out. Say that plainly instead of leaving a stale name and a
      // plan label sitting there implying an account.
      setAll(['[data-metric="user-name"]', '.user-name'], 'Signed out');
      setAll(['[data-metric="user-plan"]', '.user-plan'], '');
      setAll(['[data-metric="user-initials"]', '.user-avatar'], '–');
      return;
    }

    profile = profile || {};
    const name = [profile.firstname, profile.lastname].filter(Boolean).join(' ').trim()
      || profile.email || user.email || 'Your account';

    setAll(['[data-metric="user-name"]', '.user-name'], name);
    setAll(['[data-metric="user-initials"]', '.user-avatar'],
      initialsFrom(name === (profile.email || user.email) ? '' : name, profile.email || user.email));

    // Only state a plan we actually read. An account whose profile row could
    // not be loaded gets no label rather than a guess.
    const plan = profile.plan;
    setAll(['[data-metric="user-plan"]', '.user-plan'],
      plan ? (PLAN_LABELS[plan] || plan) : '');
  }

  document.addEventListener('DOMContentLoaded', () => { mount(); });

  return { mount, PLAN_LABELS };
})();
