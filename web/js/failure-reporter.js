/**
 * failure-reporter.js — tell somebody when a page breaks.
 *
 * Load early, before the page's own scripts:
 *   <script src="/js/failure-reporter.js"></script>
 *
 * ── Why the browser needs its own ──────────────────────────────────────────
 *
 * The server-side reporter covers everything that fails inside an endpoint. It
 * cannot see the other half: a script that throws before it renders, a
 * function that was renamed and left a call site behind, a fetch that never
 * reaches the server at all. Those failures are invisible to the deployment —
 * the customer sees a page that does nothing and the logs show a quiet,
 * healthy server.
 *
 * That half has bitten this codebase repeatedly. A literal </script> inside a
 * JS string once killed an entire agent page. Several pages called a method
 * that had never existed, hidden behind optional chaining or a bare catch. All
 * of those are exactly what window.onerror sees.
 *
 * ── Rules ──────────────────────────────────────────────────────────────────
 *
 * Same three as the server helper, for the same reasons: never throw, never
 * block, never send a credential. Plus one more that only applies here —
 *
 *   Never report in a loop. A reporter that fails and reports its own failure
 *   is a page that hammers the endpoint until the tab is closed. Reports are
 *   deduplicated within a page load, capped per load, and the reporting fetch
 *   itself is never reported.
 */
(function () {
  'use strict';

  /** Most distinct failures reported from one page load. */
  const MAX_PER_PAGE = 10;

  /** Same failure twice in this window is one report. */
  const DEDUPE_MS = 60_000;

  const seen = new Map();
  let sentCount = 0;

  /** Where this failure happened, as a stable page identity. */
  function pageSource() {
    try {
      return 'web' + (location.pathname === '/' ? '/index.html' : location.pathname);
    } catch {
      return 'web/unknown';
    }
  }

  /**
   * Strip the parts of a message that differ between occurrences of the same
   * problem, so a dedupe key groups rather than multiplies. Deliberately the
   * same shape as normalise() in api/_lib/report-failure.js — the server does
   * the authoritative grouping, this only avoids sending obvious repeats.
   */
  function key(message, extra) {
    return (String(message || '')
      .replace(/https?:\/\/[^\s"')]+/gi, '<url>')
      .replace(/\d{4,}/g, '<n>')
      .slice(0, 200) + '|' + (extra || ''));
  }

  /**
   * Send one report. Never throws, never awaited by callers.
   *
   * @param {string} message
   * @param {object} [detail]
   */
  function report(message, detail) {
    try {
      if (sentCount >= MAX_PER_PAGE) return;
      if (!message) return;

      const k = key(message, detail && detail.where);
      const now = Date.now();
      const last = seen.get(k);
      if (last && now - last < DEDUPE_MS) return;
      seen.set(k, now);
      sentCount++;

      // Only signed-in pages can report: the endpoint requires a session, and
      // without one there is nothing useful to attach the failure to anyway.
      const headersFn = window.sendAuthHeaders;
      if (typeof headersFn !== 'function') return;

      // No mutex here. An earlier version guarded with an "am I already
      // reporting" flag, which looked like loop protection and was really a
      // serialiser: every report on a page fires in the same tick, so the
      // first one held the flag and silently swallowed the rest — the page
      // reported one failure and hid the other nine. The loop it was meant to
      // prevent cannot happen anyway: the reporting fetch's own rejection is
      // caught below, so it never reaches the unhandledrejection handler.
      Promise.resolve(headersFn())
        .then(function (headers) {
          return fetch('/api/failures', {
            method: 'POST',
            headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}),
            body: JSON.stringify({
              action: 'report',
              source: pageSource(),
              message: String(message).slice(0, 2000),
              detail: Object.assign({
                url: String(location.href).slice(0, 500),
                userAgent: String(navigator.userAgent).slice(0, 200),
              }, detail || {}),
            }),
            keepalive: true,   // so a report survives the page being closed
          });
        })
        .catch(function () { /* a failed report is not itself an incident */ });
    } catch { /* rule: never throw */ }
  }

  /* ── Uncaught errors ────────────────────────────────────────────────────
     The ones nobody wrote a message for, which is what makes them worth
     hearing about. */
  window.addEventListener('error', function (e) {
    // A failed <img>/<script>/<link> also fires this, with no error object.
    // Those are worth knowing about — a 404 on a script is a dead page — but
    // they are a different thing from a thrown exception.
    if (e && e.target && e.target !== window && e.target.tagName) {
      const tag = e.target.tagName.toLowerCase();
      if (tag === 'script' || tag === 'link') {
        report(`Failed to load ${tag}: ${e.target.src || e.target.href || '(unknown)'}`,
          { where: 'resource', tag });
      }
      return;
    }
    report((e && e.message) || 'Uncaught error', {
      where: 'window.onerror',
      file: e && e.filename ? String(e.filename).slice(0, 300) : undefined,
      line: e && e.lineno,
      column: e && e.colno,
      stack: e && e.error && e.error.stack ? String(e.error.stack).split('\n').slice(0, 6).join('\n') : undefined,
    });
  }, true);

  window.addEventListener('unhandledrejection', function (e) {
    const r = e && e.reason;
    report((r && r.message) || String(r || 'Unhandled promise rejection'), {
      where: 'unhandledrejection',
      name: r && r.name,
      stack: r && r.stack ? String(r.stack).split('\n').slice(0, 6).join('\n') : undefined,
    });
  });

  /**
   * Report a failure a page already handled.
   *
   * For the honest-failure paths this product is full of: a scan that could
   * not run, an integration that answered badly. The customer is already being
   * told the truth on screen; this is what tells somebody who can fix it.
   *
   *   window.reportFailure('PageSpeed returned HTTP 429', { where: 'scan' });
   */
  window.reportFailure = report;

  /**
   * fetch(), with a failed call reported.
   *
   * A non-2xx from our own API is a server-side incident the server already
   * recorded, so those are left alone — reporting them here would double-count
   * every failure. What this catches is the call that never arrived: the
   * network is gone, the deployment is mid-rollout, a proxy ate it. That is
   * invisible server-side by definition.
   */
  window.reportedFetch = function (input, init) {
    return fetch(input, init).catch(function (err) {
      report(`Request to ${String(input).slice(0, 200)} could not be sent: ${err && err.message}`,
        { where: 'fetch', name: err && err.name });
      throw err;
    });
  };
})();
