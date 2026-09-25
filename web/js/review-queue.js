/**
 * ReviewQueue — work handed to Scotty for review.
 *
 * Carol collects what every agent has flagged; this is how a batch of it gets
 * put in front of Scotty, who is the Head the owner is meant to be able to
 * trust. Scotty gives each item a verdict with reasoning, and the owner
 * accepts or overrides it.
 *
 * Two design decisions worth stating, because both were the difference
 * between a review that means something and a review that doesn't:
 *
 * 1. Every queued item carries a SNAPSHOT of the content as it was when it
 *    was sent (`snapshot`), not just a pointer to it. A review of "post
 *    #4f2c" that has to go and re-fetch the post is a review of whatever
 *    that post says *now* — and the reasoning Scotty gave would silently
 *    stop matching the thing it was about. The snapshot is what Scotty read
 *    and what his verdict refers to.
 *
 * 2. Every item also carries `sourceRef` ({ store, id }) so that an approval
 *    is not merely a note in a queue — the decision gets written back to the
 *    record it came from (a social post actually becomes `approved`).
 *    Without this, "Scotty approved it" would change nothing anywhere.
 *
 * localStorage-only, like MissionStore: this is a working queue for the
 * current session's decisions, not durable business data. The underlying
 * records live in their own stores and are the real source of truth.
 */
window.ReviewQueue = (function () {
  'use strict';

  const KEY = 'audema_review_queue';
  const MAX_ITEMS = 200;

  function read() {
    try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
  }

  function write(list) {
    // Bound growth by dropping the oldest RESOLVED items first — never drop
    // something still awaiting a decision to make room.
    if (list.length > MAX_ITEMS) {
      const open = list.filter(i => i.status === 'pending' || i.status === 'reviewed');
      const closed = list.filter(i => i.status !== 'pending' && i.status !== 'reviewed');
      closed.sort((a, b) => new Date(a.sentAt) - new Date(b.sentAt));
      list = open.concat(closed.slice(-Math.max(0, MAX_ITEMS - open.length)));
    }
    try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* storage full/blocked */ }
    notify();
    return list;
  }

  function uid() {
    return 'rev_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  function notify() {
    try {
      window.dispatchEvent(new CustomEvent('review-queue:changed', {
        detail: { pending: pendingCount() }
      }));
    } catch { /* no-op outside a browser context */ }
  }

  /**
   * Queue items for Scotty's review.
   *
   * @param {Array<object>} items - Carol items (source, type, title, preview,
   *        payload, sourceRef, link, priority)
   * @param {{section?: string}} [meta]
   * @returns {{added: number, skipped: number}} skipped = already queued and
   *          still open, so sending a section twice doesn't duplicate it.
   */
  function send(items, meta) {
    const list = read();
    const openKeys = new Set(
      list.filter(i => i.status === 'pending' || i.status === 'reviewed')
          .map(i => i.dedupeKey)
    );

    let added = 0, skipped = 0;

    (items || []).forEach(it => {
      // Key on the underlying record where there is one, so the same post
      // sent from two different Carol sections is one review, not two.
      const dedupeKey = it.sourceRef && it.sourceRef.id
        ? `${it.sourceRef.store}:${it.sourceRef.id}`
        : `${it.source}:${it.title}`;

      if (openKeys.has(dedupeKey)) { skipped++; return; }
      openKeys.add(dedupeKey);
      added++;

      list.push({
        id: uid(),
        dedupeKey,
        section: (meta && meta.section) || null,
        agentKey: it.source || null,
        type: it.type || null,
        title: it.title || '(untitled)',
        // What Scotty actually reviews. See note 1 above.
        snapshot: it.preview || it.detail || '',
        payload: it.payload || null,
        sourceRef: it.sourceRef || null,
        link: it.link || null,
        priority: it.priority || 'medium',
        status: 'pending',           // pending -> reviewed -> approved|rejected|dismissed
        verdict: null,               // 'approve' | 'revise' | 'reject'
        reasoning: null,
        reviewedAt: null,
        decidedAt: null,
        sentAt: new Date().toISOString(),
      });
    });

    write(list);
    return { added, skipped };
  }

  /** @param {{status?: string}} [filter] */
  function list(filter) {
    const all = read();
    const status = filter && filter.status;
    const out = status ? all.filter(i => i.status === status) : all;
    return out.sort((a, b) => new Date(a.sentAt) - new Date(b.sentAt));
  }

  /** Items still needing something: not yet reviewed, or reviewed but undecided. */
  function open() {
    return read()
      .filter(i => i.status === 'pending' || i.status === 'reviewed')
      .sort((a, b) => new Date(a.sentAt) - new Date(b.sentAt));
  }

  function get(id) {
    return read().find(i => i.id === id) || null;
  }

  function pendingCount() {
    return read().filter(i => i.status === 'pending' || i.status === 'reviewed').length;
  }

  /** Record Scotty's assessment. Does not decide anything — the owner does that. */
  function setVerdict(id, { verdict, reasoning }) {
    const l = read();
    const item = l.find(i => i.id === id);
    if (!item) return null;
    item.verdict = verdict || null;
    item.reasoning = reasoning || null;
    item.reviewedAt = new Date().toISOString();
    if (item.status === 'pending') item.status = 'reviewed';
    write(l);
    return item;
  }

  /**
   * The owner's decision. Writing it back to the originating record is the
   * caller's job (it needs the store modules); this records the decision and
   * hands back the item so the caller knows what to write.
   * @param {'approved'|'rejected'|'dismissed'} decision
   */
  function decide(id, decision) {
    const l = read();
    const item = l.find(i => i.id === id);
    if (!item) return null;
    item.status = decision;
    item.decidedAt = new Date().toISOString();
    write(l);
    return item;
  }

  /** Remove everything already decided, keeping the open queue. */
  function clearResolved() {
    write(read().filter(i => i.status === 'pending' || i.status === 'reviewed'));
  }

  function clearAll() {
    try { localStorage.removeItem(KEY); } catch { /* ignore */ }
    notify();
  }

  return { send, list, open, get, pendingCount, setVerdict, decide, clearResolved, clearAll };
})();
