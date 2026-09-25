/**
 * LinkFunnelHandoff — "send these URLs to another agent", following the same
 * shape PatHandoff already established: a small localStorage payload per
 * destination, written by the sender, read by the destination page on load.
 * No generic bus — each destination's read side stays bespoke to whatever
 * field it already has, the same reasoning PatHandoff's own header gives for
 * not unifying its three payload shapes.
 *
 * Only wired to agents that already have a REAL url/domain-driven action —
 * Blade's website check has no manual-entry field to seed (its URLs only
 * ever come from a live Maps search), so it isn't a target here.
 *
 * Two consumption shapes, because the destinations genuinely differ:
 *
 *   STEP-THROUGH targets (Nancy, SEO Express Check, SEO AI Citation Check,
 *   Social Business Research) each run one slow, real-money external call
 *   per URL — auto-looping them would spend without anyone watching. The
 *   destination prefills its existing field with the first queued URL and
 *   shows "N of M — Next", advancing through the queue only as the person
 *   clicks through and reviews each result themselves.
 *
 *   BULK-IMPORT targets (Competitive Watch) are cheap, additive database
 *   rows, not paid API calls — the destination shows a single "Import all
 *   N" confirmation instead of stepping through one at a time.
 */
window.LinkFunnelHandoff = (function () {
  'use strict';

  const TARGETS = {
    nancy: { url: '/agents/nancy-agent.html', key: 'linkfunnel_incoming_nancy', mode: 'step' },
    'seo-express': { url: '/agents/seo-agent.html', key: 'linkfunnel_incoming_seo_express', mode: 'step' },
    'seo-citation': { url: '/agents/seo-agent.html', key: 'linkfunnel_incoming_seo_citation', mode: 'step' },
    'social-research': { url: '/agents/social-agent.html', key: 'linkfunnel_incoming_social_research', mode: 'step' },
    'competitive-watch': { url: '/agents/competitive-agent.html', key: 'linkfunnel_incoming_competitive_watch', mode: 'bulk' },
  };

  function labelFor(targetKey) {
    return {
      nancy: 'Nancy — Analyze Website',
      'seo-express': 'SEO — Express Site Check',
      'seo-citation': 'SEO — AI Citation Check',
      'social-research': 'Social — Business Research',
      'competitive-watch': 'Competitive Watch — Monitor as Competitors',
    }[targetKey] || targetKey;
  }

  /**
   * @param {string} targetKey - one of TARGETS' keys
   * @param {string[]} urls - already-filtered list of URLs to send
   * @param {{reportName?: string}} [meta]
   * @param {{sameTab?: boolean}} [opts]
   */
  function send(targetKey, urls, meta = {}, opts = {}) {
    const target = TARGETS[targetKey];
    if (!target) throw new Error('Unknown Link Funnel handoff target: ' + targetKey);
    if (!urls || !urls.length) throw new Error('No URLs to send.');

    const payload = {
      urls: urls.slice(),
      index: 0,
      reportName: meta.reportName || '',
      timestamp: Date.now(),
    };
    localStorage.setItem(target.key, JSON.stringify(payload));

    if (opts.sameTab === false) {
      const win = window.open(target.url, '_blank', 'noopener');
      if (win) win.focus();
      return win;
    }
    window.location.href = target.url;
    return null;
  }

  /** Destination-side: read (without consuming) whatever queue is waiting for this key. */
  function peek(targetKey) {
    const target = TARGETS[targetKey];
    if (!target) return null;
    try {
      const raw = localStorage.getItem(target.key);
      if (!raw) return null;
      const q = JSON.parse(raw);
      if (!q || !Array.isArray(q.urls) || !q.urls.length) return null;
      return q;
    } catch { return null; }
  }

  /** Destination-side: move to the next queued URL (step-through targets). Returns the updated queue, or null once exhausted. */
  function advance(targetKey) {
    const target = TARGETS[targetKey];
    if (!target) return null;
    const q = peek(targetKey);
    if (!q) return null;
    if (q.index + 1 >= q.urls.length) { clear(targetKey); return null; }
    q.index += 1;
    localStorage.setItem(target.key, JSON.stringify(q));
    return q;
  }

  /** Destination-side: dismiss a queue without acting on the rest of it. */
  function clear(targetKey) {
    const target = TARGETS[targetKey];
    if (target) localStorage.removeItem(target.key);
  }

  return { TARGETS, labelFor, send, peek, advance, clear };
})();
