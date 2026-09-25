/**
 * escape-html.js — the canonical HTML escaper for this app.
 *
 * Load before any script that builds markup from data:
 *   <script src="/js/escape-html.js"></script>
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 *
 * This codebase builds a lot of its UI by assigning template strings to
 * innerHTML, and much of what goes into those strings was written by somebody
 * other than the person looking at the page: a page the crawler read, a
 * competitor name an LLM returned, a lead record from an enrichment API, a
 * support ticket, a teammate's display name.
 *
 * Thirty-odd copies of an escaper had grown across the pages, and most of them
 * were this:
 *
 *     function escapeHtml(text) {
 *       const div = document.createElement('div');
 *       div.textContent = text;
 *       return div.innerHTML;              // ← escapes & < > and nothing else
 *     }
 *
 * That is correct for text between tags and wrong inside an attribute, because
 * the browser does not escape quotes when serialising textContent. Roughly
 * twenty call sites were attribute-position — `value="${escapeHtml(name)}"`,
 * `href="${escapeHtml(url)}"` — where a single `"` in the value ends the
 * attribute and everything after it is parsed as more attributes on the tag.
 * `onerror=` is an attribute.
 *
 * Two pages went further and defined `escAttr()` as a passthrough to exactly
 * that function: a name promising attribute safety over an implementation that
 * did not provide it.
 *
 * ── What this does ─────────────────────────────────────────────────────────
 *
 * Escapes all five characters that matter, so one function is correct in both
 * positions and there is nothing to remember at the call site. Escaping quotes
 * in text position renders identically, so the stricter version is never the
 * wrong choice.
 *
 * It is NOT sufficient for these, which no HTML escaper can make safe:
 *   - inside a <script> block, or an on*= handler that builds JS from data
 *   - a URL in href/src (an escaped `javascript:` URL is still javascript:)
 *   - inside a <style> block or a style="" attribute
 * Use escapeJs() below for the second context, and check the scheme for URLs.
 */
(function () {
  'use strict';

  const HTML_ENTITIES = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };

  /**
   * Escape a value for insertion into HTML, in text or attribute position.
   * null and undefined become '' rather than the words "null"/"undefined".
   */
  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, c => HTML_ENTITIES[c]);
  }

  /**
   * Escape a value for use inside a JavaScript string literal — the
   * `onclick="doThing('${...}')"` shape that appears in a few places here.
   *
   * This is a second context nested inside the first, and escapeHtml() does
   * not cover it: an HTML entity is decoded by the parser before the JS runs,
   * so `&#39;` becomes a real quote by the time it reaches the interpreter.
   * A value passed through both is safe; through either alone it is not.
   *
   * Prefer not needing it. An event listener attached in code, closing over
   * the value, has no string to escape and no second context to get wrong.
   */
  function escapeJs(value) {
    return String(value == null ? '' : value)
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'")
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/</g, '\\x3C')     // so </script> inside a string cannot end the block
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029');
  }

  /**
   * Return a URL only if it is one worth putting in an href or src.
   *
   * http(s), mailto and tel are allowed; anything else — javascript:, data:,
   * vbscript: — returns '' so the link is inert rather than hostile. Escaping
   * does nothing here: `javascript:alert(1)` survives HTML-escaping unchanged
   * because it contains none of the five characters.
   */
  function safeUrl(value) {
    const s = String(value == null ? '' : value).trim();
    if (!s) return '';

    // Strip whitespace and control characters before looking at the scheme:
    // browsers ignore them inside one, so "java\tscript:alert(1)" and
    // "java\nscript:alert(1)" both run.
    const cleaned = s.replace(/[\s\u0000-\u0020]/g, '');

    // A scheme is letters/digits/+/-/. before the first colon, and only when
    // nothing in front of that colon is a / ? or #. Anything else —
    // "docs/api:v2", "/dashboard.html", "#top" — is a relative URL with no
    // scheme to abuse.
    const m = cleaned.match(/^([A-Za-z][A-Za-z0-9+.-]*):/);
    if (!m) return s;

    return /^(https?|mailto|tel)$/i.test(m[1]) ? s : '';
  }

  window.escapeHtml = escapeHtml;
  // escAttr existed on two pages as a passthrough to an escaper that did not
  // escape quotes. Kept as a name, now pointing at one that does — the same
  // function is correct in both positions.
  window.escAttr = escapeHtml;
  window.escapeJs = escapeJs;
  window.safeUrl = safeUrl;
})();
