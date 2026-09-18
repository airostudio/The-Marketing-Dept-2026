/**
 * CarolAggregator — pulls together what every other agent has already found,
 * flagged, or queued, so Carol can present one prioritized briefing instead
 * of a user having to visit 16 separate pages to know what needs attention.
 *
 * Deliberately NOT a new store. Every agent already writes its output
 * somewhere (AgentHistory, SocialPostsStore, SEOPipelineStore,
 * CompetitiveRadar, the CRO ICE backlog, Chase's own pipeline) — this reads
 * all of them and normalizes into one shape. Every source is wrapped so a
 * missing store, a signed-out session, or an agent nobody's used yet
 * contributes nothing rather than breaking the whole digest.
 *
 * Both gaps noted when this file was first built are now fixed upstream:
 *  - Scotty's `requires_approval` mission automations now persist via
 *    MissionStore.getPendingApprovals() (see mission-store.js) instead of
 *    living only in an in-memory array that vanished on refresh.
 *  - CompetitiveRadar is now scoped per project/profile the same way
 *    BusinessBrain/ContactsStore/SocialPosts/SEOPipeline already were
 *    (see intelligence-engine.js), so this reads real per-project data.
 */
window.CarolAggregator = (function () {
  'use strict';

  // Canonical hub colors — NOT web/js/agent-history.js's AGENT_META, which
  // has drifted from the real hub-card colors for several agents (confirmed
  // during Carol's own research pass). This is the source of truth instead.
  const AGENT_INFO = {
    seo:                    { label: 'SEO Intelligence',    icon: '🔍', color: '#06b6d4', route: '/agents/seo-agent.html' },
    social:                 { label: 'Social Studio',       icon: '📱', color: '#8b5cf6', route: '/agents/social-agent.html' },
    ads:                    { label: 'Ad Creative Lab',     icon: '🎨', color: '#8b5cf6', route: '/agents/social-agent.html' },
    sales:                  { label: 'Sales Intelligence',  icon: '🎯', color: '#10b981', route: '/agents/sales-agent.html' },
    cro:                    { label: 'CRO Lab',             icon: '🧪', color: '#ef4444', route: '/agents/cro-agent.html' },
    competitive:            { label: 'Competitive Intel',   icon: '🕵️', color: '#14b8a6', route: '/agents/competitive-agent.html' },
    compliance:             { label: 'Compliance Guard',    icon: '🛡️', color: '#64748b', route: '/agents/compliance-agent.html' },
    'compliance-automation':{ label: 'Enterprise Compliance', icon: '🔒', color: '#475569', route: '/agents/compliance-automation.html' },
    email:                  { label: 'Email Engine',        icon: '📧', color: '#ec4899', route: '/agents/email-agent.html' },
    'email-delivery':       { label: 'Email Delivery',      icon: '📬', color: '#10b981', route: '/agents/email-delivery-agent.html' },
    'content-studio':       { label: 'Content Studio',      icon: '✍️', color: '#6366f1', route: '/agents/content-studio-agent.html' },
    linkedin:               { label: 'LinkedIn Outreach',   icon: '💼', color: '#3b82f6', route: '/agents/linkedin-agent.html' },
    video:                  { label: 'Video Studio',        icon: '🎬', color: '#06b6d4', route: '/agents/video-agent.html' },
    deck:                   { label: 'Deck Maker',          icon: '📽️', color: '#7c3aed', route: '/agents/deck-agent.html' },
    analytics:              { label: 'Analytics Brain',     icon: '📊', color: '#f59e0b', route: '/agents/analytics-agent.html' },
    blade:                  { label: 'Google Maps Scraper', icon: '🗡️', color: '#f43f5e', route: '/agents/blade-agent.html' },
    beeker:                 { label: 'Audience Manager',    icon: '👩‍🔬', color: '#06b6d4', route: '/agents/audience-agent.html' },
    nancy:                  { label: 'Instagram',           icon: '📸', color: '#e53e3e', route: '/agents/nancy-agent.html' },
  };

  function info(key) {
    return AGENT_INFO[key] || { label: key || 'Unknown', icon: '🤖', color: '#94a3b8', route: '/hub.html' };
  }

  function safe(fn, fallback) {
    try { return fn(); } catch (e) { return fallback; }
  }
  async function safeAsync(fn, fallback) {
    try { return await fn(); } catch (e) { return fallback; }
  }

  let uidCounter = 0;
  /**
   * Every item carries, beyond the one-line summary:
   *   preview   — the ACTUAL content being flagged (the post body, the
   *               outreach email, the test hypothesis), so a decision can be
   *               made here rather than by opening an agent page that has no
   *               idea which item was meant.
   *   payload   — the raw record, for anything that wants the structured form.
   *   sourceRef — { store, id } so a decision can be written back to the
   *               record it came from.
   */
  function makeItem(fields) {
    uidCounter++;
    return Object.assign({
      id: 'carol_' + Date.now().toString(36) + '_' + uidCounter,
      priority: 'medium',
      timestamp: new Date().toISOString(),
      detail: '',
      preview: '',
      payload: null,
      sourceRef: null,
    }, fields);
  }

  /** Join labelled sections, dropping any with nothing in them. */
  function buildPreview(parts) {
    return parts
      .filter(p => p && p[1] != null && String(p[1]).trim() !== '')
      .map(([label, value]) => (label ? `${label}: ${String(value).trim()}` : String(value).trim()))
      .join('\n');
  }

  /** Append a query param to an agent route so it can open on the right item. */
  function deepLink(route, params) {
    const qs = Object.entries(params || {})
      .filter(([, v]) => v != null && v !== '')
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');
    return qs ? `${route}?${qs}` : route;
  }

  async function fromSocialPosts() {
    if (!window.SocialPostsStore) return [];
    const posts = await safeAsync(() => window.SocialPostsStore.listPosts({ status: 'pending_review' }), []);
    return posts.map(p => makeItem({
      source: p.source === 'ad' ? 'ads' : 'social',
      type: 'needs_approval',
      title: `Review ${p.source === 'ad' ? 'ad' : 'social post'}: ${p.headline || p.hook || '(untitled)'}`,
      detail: `${p.platform || ''} · ${(p.body || '').slice(0, 100)}`,
      // The whole post, as it would go out.
      preview: buildPreview([
        ['Platform', p.platform],
        ['Hook', p.hook],
        ['Headline', p.headline],
        ['Body', p.body],
        ['CTA', p.cta],
        ['Hashtags', (p.hashtags || []).join(' ')],
        ['Proof point', p.proof_point],
        ['Urgency', p.urgency_line],
        ['Visual direction', p.visual_direction],
      ]),
      payload: p,
      sourceRef: { store: 'social_posts', id: p.id },
      priority: 'high',
      timestamp: p.created_at,
      link: deepLink(info(p.source === 'ad' ? 'ads' : 'social').route, { post: p.id }),
      imageUrl: p.image_url || null,
    }));
  }

  async function fromSeoPipeline() {
    if (!window.SEOPipelineStore) return [];
    const runs = await safeAsync(() => window.SEOPipelineStore.listRuns(), []);
    const results = [];
    // Cap fan-out to the most recent runs — a long-lived account could have
    // dozens of runs, and Carol only needs what's actionable right now.
    for (const run of runs.slice(0, 5)) {
      const prospects = await safeAsync(() => window.SEOPipelineStore.listProspects(run.id), []);
      for (const p of prospects) {
        // The email itself is the thing being approved — an outreach item
        // reviewed without its subject and body is a decision made blind.
        const draft = buildPreview([
          ['To', p.contact_email || p.contact_name || p.domain],
          ['Target page', p.page_url],
          ['Subject', p.outreach_subject],
          ['Body', p.outreach_body],
          ['Why this target', p.relevance_reason],
          ['Data source', p.data_source === 'real' ? 'verified backlink data' : 'AI-suggested, not yet verified'],
        ]);

        if (p.status === 'queued') {
          results.push(makeItem({
            source: 'seo', type: 'needs_approval',
            title: `Backlink outreach ready to send: ${p.domain}`,
            detail: p.outreach_subject || p.relevance_reason || '',
            preview: draft,
            payload: p,
            sourceRef: { store: 'seo_backlink_prospects', id: p.id },
            priority: 'high',
            timestamp: p.created_at,
            link: deepLink(info('seo').route, { prospect: p.id, run: run.id }),
          }));
        } else if (p.status === 'found' || p.status === 'drafted') {
          results.push(makeItem({
            source: 'seo', type: 'backlog',
            title: `Backlink prospect: ${p.domain}`,
            detail: p.relevance_reason || '',
            preview: draft,
            payload: p,
            sourceRef: { store: 'seo_backlink_prospects', id: p.id },
            priority: 'low',
            timestamp: p.created_at,
            link: deepLink(info('seo').route, { prospect: p.id, run: run.id }),
          }));
        }
      }
    }
    return results;
  }

  function fromCompetitiveRadar() {
    if (!window.IntelligenceEngine || !window.IntelligenceEngine.radar) return [];
    const gaps = safe(() => window.IntelligenceEngine.radar.getTopGaps(), []);
    return gaps.map(g => makeItem({
      source: 'competitive', type: 'opportunity',
      title: `Gap vs ${g.competitor}: ${g.gap.gap}`,
      detail: g.gap.opportunity || '',
      preview: buildPreview([
        ['Competitor', g.competitor],
        ['Gap identified', g.gap.gap],
        ['Opportunity', g.gap.opportunity],
        ['Priority', g.gap.priority],
        ['Evidence', g.gap.evidence],
      ]),
      payload: g,
      priority: g.gap.priority || 'medium',
      link: info('competitive').route,
    }));
  }

  function fromCroBacklog() {
    let tests = [];
    try { tests = JSON.parse(localStorage.getItem('cro_ice_tests') || '[]'); } catch (e) { tests = []; }
    return tests.map(t => {
      const score = ((t.impact || 5) * (t.confidence || 5) * (t.ease || 5)) / 10;
      return makeItem({
        source: 'cro', type: 'backlog',
        title: `Test idea: ${t.name}`,
        detail: `ICE score ${Math.round(score)}`,
        preview: buildPreview([
          ['Test', t.name],
          ['Hypothesis', t.hypothesis],
          ['Page', t.page || t.url],
          ['Impact', t.impact], ['Confidence', t.confidence], ['Ease', t.ease],
          ['ICE score', Math.round(score)],
          ['Notes', t.notes],
        ]),
        payload: t,
        sourceRef: t.id ? { store: 'cro_ice_tests', id: t.id } : null,
        priority: score >= 50 ? 'high' : score >= 25 ? 'medium' : 'low',
        link: info('cro').route,
      });
    });
  }

  function fromChasePipeline() {
    let prospects = [];
    try { prospects = JSON.parse(localStorage.getItem('chase_v3') || '[]'); } catch (e) { prospects = []; }
    return prospects
      .filter(p => ['new', 'contacted', 'qualified', 'proposal'].includes(p.status))
      .map(p => makeItem({
        source: 'sales',
        type: (p.status === 'qualified' || p.status === 'proposal') ? 'opportunity' : 'backlog',
        title: `${p.name} — ${p.status}`,
        detail: p.notes || '',
        preview: buildPreview([
          ['Prospect', p.name],
          ['Company', p.company],
          ['Status', p.status],
          ['Website', p.website],
          ['Email', p.email],
          ['Phone', p.phone],
          ['Notes', p.notes],
          ['Next step', p.nextStep],
        ]),
        payload: p,
        sourceRef: p.id ? { store: 'chase_v3', id: p.id } : null,
        priority: p.status === 'proposal' ? 'high' : p.status === 'qualified' ? 'medium' : 'low',
        timestamp: p.addedAt,
        link: info('sales').route,
      }));
  }

  function fromAgentHistory(limit) {
    if (!window.AgentHistory) return [];
    const all = safe(() => window.AgentHistory.getAll(), []);
    return all.slice(0, limit).map(h => makeItem({
      source: h.agentKey, type: 'recent',
      title: `${h.taskType || 'Output'}${h.topic ? ': ' + h.topic : ''}`,
      detail: (h.content || '').slice(0, 140),
      // The agent's full output, so "recent activity" can actually be read
      // rather than just acknowledged.
      preview: h.content || '',
      payload: h,
      sourceRef: h.id ? { store: 'agent_history', id: h.id } : null,
      priority: 'low',
      timestamp: h.timestamp,
      link: info(h.agentKey).route,
    }));
  }

  function fromPendingApprovals() {
    if (!window.MissionStore || !window.MissionStore.getPendingApprovals) return [];
    const approvals = safe(() => window.MissionStore.getPendingApprovals(), []);
    return approvals.map(a => makeItem({
      source: a.agentKey, type: 'needs_approval',
      title: `Approve: ${a.title}`,
      detail: a.description || '',
      preview: buildPreview([
        ['Action', a.title],
        ['What it does', a.description],
        ['Impact', a.impact],
        ['Time estimate', a.timeEstimate],
        ['Deliverable', a.deliverable],
        ['Instruction the agent would run', a.prompt],
      ]),
      payload: a,
      sourceRef: { store: 'pending_approvals', id: a.id },
      priority: 'high',
      timestamp: a.createdAt,
      link: '/scotty.html',
    }));
  }

  function activeMission() {
    if (!window.MissionStore) return null;
    return safe(() => window.MissionStore.getActive(), null);
  }

  /**
   * @returns {Promise<{mission: object|null, sections: {needsApproval, opportunities, backlog, recent}}>}
   */
  async function collect() {
    const [socialItems, seoItems] = await Promise.all([
      fromSocialPosts(),
      fromSeoPipeline(),
    ]);
    const competitiveItems = fromCompetitiveRadar();
    const croItems = fromCroBacklog();
    const chaseItems = fromChasePipeline();
    const approvalItems = fromPendingApprovals();
    const recentItems = fromAgentHistory(15);

    const all = [...socialItems, ...seoItems, ...competitiveItems, ...croItems, ...chaseItems, ...approvalItems];

    const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };
    const byRecency = (a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0);
    const sortItems = (arr) => arr.sort((a, b) => (PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]) || byRecency(a, b));

    return {
      mission: activeMission(),
      sections: {
        needsApproval: sortItems(all.filter(i => i.type === 'needs_approval')),
        opportunities: sortItems(all.filter(i => i.type === 'opportunity')),
        backlog: sortItems(all.filter(i => i.type === 'backlog')),
        recent: recentItems.sort(byRecency),
      },
    };
  }

  return { collect, info };
})();
