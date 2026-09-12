/**
 * End-to-end check of the Carol -> Scotty review handoff.
 *
 * What this guards, in order of how it actually broke:
 *  1. Carol's cards used to carry a 100-char snippet and a bare agent route,
 *     so "review this post" opened an agent page with no idea which post was
 *     meant - a blank page. The card must now contain the real content.
 *  2. A section must be sendable to Scotty as a batch, carrying that content
 *     with it, because Scotty reviewing a title is not a review.
 *  3. Scotty's verdict is a recommendation; the owner's decision is what
 *     writes back to the originating record.
 *
 *   PLAYWRIGHT_PATH=/opt/node22/lib/node_modules/playwright node tests/carol-review/run.js
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '../..');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');

// A social post exactly as SocialPostsStore returns it.
const POST = {
  id: 'post-abc-123',
  source: 'organic',
  platform: 'LinkedIn',
  hook: 'Most ops teams are drowning in status meetings.',
  headline: 'Cut your status meetings in half',
  body: 'We looked at 400 ops teams. The ones that shipped fastest had one thing in common: they replaced standups with a written daily log. Here is the exact template they used.',
  cta: 'Grab the template',
  hashtags: ['ops', 'productivity'],
  proof_point: '400 teams studied',
  urgency_line: null,
  visual_direction: 'Split screen: cluttered calendar vs one clean doc',
  image_url: null,
  status: 'pending_review',
  created_at: new Date().toISOString(),
};

const updateStatusCalls = [];

const HARNESS = `<!DOCTYPE html><html><body>
<div id="reviewInboxBtn" style="display:none"><span id="reviewInboxCount">0</span></div>
<div id="reviewModalOverlay"><div id="reviewModalBody"></div></div>
<button id="btnReviewAll"></button><button id="btnReviewModalClose"></button>

<script>
// ── Stubs for what Carol's aggregator reads ──────────────────────────────
window.SocialPostsStore = {
  listPosts: async () => ([${JSON.stringify(POST)}]),
  updateStatus: async (id, status, note) => {
    window.__updateStatusCalls = window.__updateStatusCalls || [];
    window.__updateStatusCalls.push({ id, status, note });
    return true;
  },
};
window.AgentHistory = { getAll: () => [] };
window.MissionStore = { getActive: () => null, getPendingApprovals: () => [] };
window.InfoPanel = { logActivity: () => {} };

// Scotty's LLM, stubbed with a well-formed verdict.
window.ClaudeService = {
  callAgent: async ({ messages }) => {
    window.__lastPrompt = messages[0].content;
    return 'VERDICT: approve\\nREASON: Strong hook, the proof point is concrete, and the CTA matches the offer. Ship it.';
  },
};
</script>
<script src="/js/carol-aggregator.js"></script>
<script src="/js/review-queue.js"></script>
</body></html>`;

const server = http.createServer((req, res) => {
  if (req.url === '/x.html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(HARNESS);
  }
  const m = req.url.match(/^\/js\/([\w.-]+)$/);
  if (m) {
    const f = path.join(REPO, 'web/js', m[1]);
    if (fs.existsSync(f)) {
      res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8' });
      return res.end(fs.readFileSync(f, 'utf8'));
    }
  }
  res.writeHead(404); res.end();
});

server.listen(0, async () => {
  const port = server.address().port;
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  await page.goto(`http://localhost:${port}/x.html`);

  const fail = [];
  const check = (name, cond) => {
    console.log((cond ? '  PASS  ' : '  FAIL  ') + name);
    if (!cond) fail.push(name);
  };

  // ── 1. Carol carries the real content ──────────────────────────────────
  const collected = await page.evaluate(async () => {
    const data = await window.CarolAggregator.collect();
    return data.sections.needsApproval[0] || null;
  });

  console.log('\n──── the item Carol produces ────');
  console.log('title  :', collected && collected.title);
  console.log('link   :', collected && collected.link);
  console.log('preview:\n' + (collected ? collected.preview.split('\n').map(l => '   ' + l).join('\n') : '(none)'));

  console.log('\n──── assertions ────');
  check('Carol produced an item for the pending post', !!collected);
  check('preview contains the REAL post body (not a 100-char snippet)',
    !!collected && collected.preview.includes('they replaced standups with a written daily log'));
  check('preview includes headline, CTA and platform',
    !!collected && collected.preview.includes('Cut your status meetings in half') &&
    collected.preview.includes('Grab the template') && collected.preview.includes('LinkedIn'));
  check('link deep-links to the specific post, not the bare agent route',
    !!collected && collected.link.includes('post=post-abc-123'));
  check('sourceRef points back at the originating record',
    !!collected && collected.sourceRef.store === 'social_posts' && collected.sourceRef.id === 'post-abc-123');

  // ── 2. Sending a section to Scotty carries the content ────────────────
  const sendResult = await page.evaluate(async () => {
    const data = await window.CarolAggregator.collect();
    const first = window.ReviewQueue.send(data.sections.needsApproval, { section: 'Needs your decision' });
    const second = window.ReviewQueue.send(data.sections.needsApproval, { section: 'Needs your decision' });
    const queued = window.ReviewQueue.open()[0];
    return { first, second, queued, pending: window.ReviewQueue.pendingCount() };
  });

  check('sending a section queues the item', sendResult.first.added === 1);
  check('re-sending the same section does not duplicate it',
    sendResult.second.added === 0 && sendResult.second.skipped === 1 && sendResult.pending === 1);
  check('queued item carries the content snapshot, not just a title',
    sendResult.queued.snapshot.includes('written daily log'));
  check('queued item keeps its sourceRef for write-back',
    sendResult.queued.sourceRef && sendResult.queued.sourceRef.id === 'post-abc-123');

  // ── 3. Scotty reviews the real content, owner decides ─────────────────
  const reviewed = await page.evaluate(async () => {
    // Mirror ReviewInbox's review step (the module lives inside scotty.html).
    const it = window.ReviewQueue.open()[0];
    const prompt =
      'ITEM TYPE: ' + it.agentKey + '\nTITLE: ' + it.title +
      '\n\nTHE ACTUAL CONTENT:\n' + it.snapshot;
    const text = await window.ClaudeService.callAgent({ messages: [{ role: 'user', content: prompt }] });
    const v = (text.match(/VERDICT:\s*(approve|revise|reject)/i) || [])[1];
    const r = (text.match(/REASON:\s*([\s\S]+)/i) || [])[1];
    window.ReviewQueue.setVerdict(it.id, { verdict: v.toLowerCase(), reasoning: r.trim() });

    const after = window.ReviewQueue.get(it.id);

    // Owner's decision + write-back, as ReviewInbox.decide() does.
    const decided = window.ReviewQueue.decide(it.id, 'approved');
    await window.SocialPostsStore.updateStatus(decided.sourceRef.id, 'approved', 'Scotty review: ' + decided.reasoning);

    return {
      promptSeen: window.__lastPrompt,
      verdict: after.verdict,
      reasoning: after.reasoning,
      statusAfterVerdict: after.status,
      statusAfterDecision: window.ReviewQueue.get(it.id).status,
      writeBack: window.__updateStatusCalls,
      pendingNow: window.ReviewQueue.pendingCount(),
    };
  });

  check('Scotty was shown the actual content, not just the title',
    reviewed.promptSeen.includes('written daily log'));
  check('verdict recorded from the response', reviewed.verdict === 'approve');
  check('reasoning recorded', /Strong hook/.test(reviewed.reasoning));
  check('verdict alone does NOT decide it (status stays reviewed)',
    reviewed.statusAfterVerdict === 'reviewed');
  check("owner's approval marks it approved", reviewed.statusAfterDecision === 'approved');
  check('approval is written back to the source post',
    reviewed.writeBack.length === 1 &&
    reviewed.writeBack[0].id === 'post-abc-123' &&
    reviewed.writeBack[0].status === 'approved');
  check('decided item leaves the open queue', reviewed.pendingNow === 0);
  check('no JS errors', pageErrors.length === 0);
  if (pageErrors.length) console.log('  errors:', pageErrors);

  console.log('\n' + (fail.length === 0
    ? 'ALL ASSERTIONS PASSED'
    : `${fail.length} FAILED: ${fail.join(' | ')}`));

  await browser.close();
  server.close();
  process.exit(fail.length === 0 ? 0 : 1);
});
