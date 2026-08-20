/**
 * URL Utils — auto-adds https:// to URL inputs across the app
 * Audema Marketing 2026
 *
 * Users routinely type "example.com" or "www.example.com" into a URL field
 * without the scheme, which then fails a fetch/crawl or gets rejected by an
 * API expecting a well-formed URL. This normalizes it for them instead of
 * erroring — same behavior as pretty much every SaaS "enter your website"
 * field. Only fills in a missing scheme; never rewrites a URL that already
 * has one (http://, mailto:, tel:, a protocol-relative "//...", etc.).
 */

(function () {
  'use strict';

  function normalizeUrl(raw) {
    if (raw == null) return raw;
    var v = String(raw).trim();
    if (!v) return v;
    // Already has a scheme (http:, https:, ftp:, mailto:, tel:, data:, ...) — leave it.
    if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return v;
    // Protocol-relative ("//example.com") — leave it, the browser resolves it.
    if (v.indexOf('//') === 0) return v;
    return 'https://' + v;
  }

  function autoPrefixOn(el) {
    if (!el || el.__urlAutoPrefixBound) return;
    el.__urlAutoPrefixBound = true;
    el.addEventListener('blur', function () {
      var fixed = normalizeUrl(el.value);
      if (fixed !== el.value) {
        el.value = fixed;
        // Let any input/change listeners already on the field know the
        // value moved, so state bound to oninput doesn't go stale.
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
  }

  function isUrlField(el) {
    if (!el || el.tagName !== 'INPUT') return false;
    if (el.type === 'url') return true;
    // Some fields are plain type="text" but clearly URL fields by name/id —
    // covers cases where the markup wasn't given type="url".
    var hint = ((el.id || '') + ' ' + (el.name || '')).toLowerCase();
    return el.type === 'text' && /url$/i.test(hint);
  }

  function autoPrefixAll(root) {
    var scope = root || document;
    var els = scope.querySelectorAll('input[type="url"]');
    for (var i = 0; i < els.length; i++) autoPrefixOn(els[i]);
  }

  function scanNode(node) {
    if (!node || node.nodeType !== 1) return;
    if (isUrlField(node)) autoPrefixOn(node);
    if (node.querySelectorAll) autoPrefixAll(node);
  }

  // Covers inputs rendered dynamically after page load (competitor rows,
  // profile forms, etc.) without needing every render call site updated.
  function observe() {
    if (!window.MutationObserver) return;
    var observer = new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var added = mutations[i].addedNodes;
        for (var j = 0; j < added.length; j++) scanNode(added[j]);
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  window.UrlUtils = {
    normalize: normalizeUrl,
    autoPrefixOn: autoPrefixOn,
    autoPrefixAll: autoPrefixAll,
  };

  function boot() {
    autoPrefixAll(document);
    observe();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
