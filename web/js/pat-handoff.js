/**
 * PatHandoff — one place for "send this to Pat", instead of every agent
 * re-implementing localStorage.setItem('pat_incoming_draft', ...) by hand.
 *
 * This normalizes the CALL SITE only — the on-disk localStorage shapes are
 * unchanged from what they were before this file existed, so Pat's read
 * side (email-delivery-agent.html's loadIncomingDraft()/
 * loadIncomingOutreach()) needs no changes at all. Three existing payload
 * shapes, kept as-is on purpose (a disruptive rewrite of all three risked
 * breaking Pat's already-working tabs for no real gain):
 *
 *   - pat_incoming_draft    — single object, one-shot draft (Nova, Scotty)
 *   - pat_incoming_outreach — array/queue, backlink prospects (Rex/SEO)
 *   - ?segment=<id> URL param — audience segment (Chase, Mex, Blade)
 */
window.PatHandoff = (function () {
  'use strict';

  const PAT_URL = '/agents/email-delivery-agent.html';
  const PAT_TAB_NAME = 'audema_pat_tab';

  function go(url, opts) {
    if (opts.sameTab) { window.location.href = url; return null; }
    const name = opts.namedTab ? PAT_TAB_NAME : '_blank';
    const win = window.open(url, name, 'noopener');
    if (win) win.focus();
    return win;
  }

  /**
   * @param {{campaignName, subject, html, text}} draft
   * @param {{sameTab?: boolean}} [opts]
   */
  function sendDraft(draft, opts = {}) {
    const payload = {
      campaignName: draft.campaignName || '',
      subject: draft.subject || '',
      html: draft.html || '',
      text: draft.text || '',
      timestamp: Date.now(),
    };
    localStorage.setItem('pat_incoming_draft', JSON.stringify(payload));
    return go(PAT_URL, opts);
  }

  /**
   * @param {{prospectId, runId, domain, to, subject, body, website}} item
   * @param {{sameTab?: boolean}} [opts]
   */
  function sendOutreach(item, opts = {}) {
    let queue = [];
    try { queue = JSON.parse(localStorage.getItem('pat_incoming_outreach') || '[]'); } catch { queue = []; }
    if (!Array.isArray(queue)) queue = [];
    // Replace any existing queued item for this same prospect rather than
    // duplicating it, so re-approving an edit doesn't leave Pat with two.
    queue = queue.filter(q => !(item.prospectId && q.prospectId === item.prospectId));
    queue.push({
      timestamp: Date.now(),
      prospectId: item.prospectId || null,
      runId: item.runId || null,
      domain: item.domain,
      to: item.to,
      subject: item.subject,
      body: item.body,
      website: item.website || '',
    });
    localStorage.setItem('pat_incoming_outreach', JSON.stringify(queue));
    // Cache-busting ?t= forces the destination to reload even if a named
    // tab from a prior approval is already sitting on this same URL, so it
    // actually re-reads the updated queue instead of showing stale state.
    return go(`${PAT_URL}?t=${Date.now()}#backlinks`, Object.assign({ namedTab: true }, opts));
  }

  /**
   * @param {string} segmentId
   * @param {{sameTab?: boolean}} [opts]
   */
  function sendSegment(segmentId, opts = {}) {
    return go(`${PAT_URL}?segment=${encodeURIComponent(segmentId)}`, opts);
  }

  return { sendDraft, sendOutreach, sendSegment };
})();
