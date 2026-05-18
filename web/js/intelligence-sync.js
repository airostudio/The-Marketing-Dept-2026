/**
 * intelligence-sync.js
 * Single source of truth: reads SEO project + analysis data and auto-populates
 * the four Intelligence Layer stores, then fires 'intelligence:synced' so each
 * page can re-render with the new data.
 *
 * Runs SYNCHRONOUSLY when the script tag is parsed (scripts are at bottom of
 * body so the DOM is fully built). Only the toast banner is deferred.
 *
 * Storage keys read:
 *   seo-current-project-data  → project wizard output
 *   seo-analysis-results      → analysis engine output
 *
 * Storage keys written  (matching each page's local-fallback shim):
 *   tmd_radar            → competitive-radar.html  (array of competitor objects)
 *   intel_business_brain → business-brain.html     (brain profile object)
 *   tmd_pulse_signals    → market-pulse.html       (array of signal objects)
 *   tmd_pulse_gaps       → market-pulse.html       (array of gap objects)
 *   intel_strategic_briefs → strategic-brief.html  (seed context)
 */

(function () {
  'use strict';

  const KEYS = {
    PROJECT:  'seo-current-project-data',
    ANALYSIS: 'seo-analysis-results',
    // Destination keys — must match each page's local storage shim
    RADAR:    'tmd_radar',
    BRAIN:    'intel_business_brain',
    PULSE:    'tmd_pulse_signals',
    GAPS:     'tmd_pulse_gaps',
    BRIEFS:   'intel_strategic_briefs',
    SYNCED:   'intel_sync_state',
  };

  // ─── Helpers ──────────────────────────────────────────────────────────────

  function read(key) {
    try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
  }

  function write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); }
    catch (e) { console.warn('[IntelligenceSync] write failed:', key, e); }
  }

  function normaliseUrl(url) {
    if (!url) return '';
    return url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '').toLowerCase();
  }

  // ─── Sync: Competitive Radar (tmd_radar) ──────────────────────────────────

  function syncRadar(project) {
    if (!project) return 0;
    const rawComps = project.competitors || [];
    if (!rawComps.length) return 0;

    const existing = read(KEYS.RADAR) || [];
    const existingUrls  = new Set(existing.map(c => normaliseUrl(c.url)));
    const existingNames = new Set(existing.map(c => (c.name || '').toLowerCase().trim()));

    let added = 0;
    rawComps.forEach(comp => {
      const name = (typeof comp === 'string' ? comp : comp.name || '').trim();
      const url  = (typeof comp === 'string' ? ''   : comp.url  || '').trim();
      if (!name && !url) return;

      const normUrl  = normaliseUrl(url);
      const normName = name.toLowerCase();
      if ((normUrl  && existingUrls.has(normUrl))  ||
          (normName && existingNames.has(normName))) return;

      // Schema matches the competitive-radar.html local-fallback shim
      existing.push({
        id: 'c_sync_' + Date.now() + '_' + added,
        name,
        url,
        positioning: '',
        audience: '',
        messages: '',
        tone: '',
        moves: [],
        borrowedIdeas: [],
        marketGaps: [],
        addedBy: 'sync',
      });
      if (normUrl)  existingUrls.add(normUrl);
      if (normName) existingNames.add(normName);
      added++;
    });

    if (added) write(KEYS.RADAR, existing);
    return added;
  }

  // ─── Sync: Business Brain (intel_business_brain) ──────────────────────────

  function syncBrain(project) {
    if (!project) return 0;
    const existing = read(KEYS.BRAIN) || {};
    let changed = 0;

    function setIfEmpty(path, value) {
      if (!value) return;
      const parts = path.split('.');
      let obj = existing;
      for (let i = 0; i < parts.length - 1; i++) {
        if (obj[parts[i]] == null) obj[parts[i]] = {};
        obj = obj[parts[i]];
      }
      const last = parts[parts.length - 1];
      if (!obj[last]) { obj[last] = value; changed++; }
    }

    setIfEmpty('company.name',     project.projectName);
    setIfEmpty('company.website',  project.websiteUrl);
    setIfEmpty('company.industry', project.industry);
    if (!existing.companyName && project.projectName) { existing.companyName = project.projectName; changed++; }
    if (!existing.website    && project.websiteUrl)   { existing.website    = project.websiteUrl;   changed++; }

    if (changed) write(KEYS.BRAIN, existing);
    return changed;
  }

  // ─── Sync: Market Pulse signals (tmd_pulse_signals) ───────────────────────
  // Schema MUST match the market-pulse.html local-fallback shim:
  //   { id, content, type, strength:'Strong'|'Moderate'|'Weak', date, source, addedBy }

  function syncPulse(analysis) {
    if (!analysis || !Array.isArray(analysis.issues)) return 0;

    const existing = read(KEYS.PULSE) || [];
    const existingTitles = new Set(existing.map(s => (s.content || s.title || '').toLowerCase()));

    const criticalAndHigh = analysis.issues
      .filter(i => i.severity === 'critical' || i.severity === 'high')
      .slice(0, 10);

    let added = 0;

    criticalAndHigh.forEach(issue => {
      // market-pulse render reads s.content — use that as the primary field
      const content = (issue.title || issue.type || issue.message || 'SEO Issue').trim();
      const detail  = issue.description || issue.detail || `Detected during SEO audit: ${content}`;
      const full    = detail ? `${content} — ${detail}` : content;

      if (existingTitles.has(content.toLowerCase())) return;

      existing.push({
        id:       's_sync_' + Date.now() + '_' + added,
        content:  full,            // market-pulse renders s.content
        title:    content,         // convenience alias
        type:     mapIssueType(issue),
        strength: issue.severity === 'critical' ? 'Strong' : 'Moderate', // capitalized to match page filter
        date:     new Date().toISOString(),
        source:   'SEO Audit',
        addedBy:  'sync',
      });
      existingTitles.add(content.toLowerCase());
      added++;
    });

    // Health-score signal
    if (analysis.healthScore != null) {
      const scoreContent = `Website Health Score: ${analysis.healthScore}/100`;
      if (!existingTitles.has(scoreContent.toLowerCase())) {
        existing.push({
          id:       's_sync_score_' + Date.now(),
          content:  `${scoreContent}. ${
            analysis.healthScore < 50 ? 'Significant improvement opportunity.' :
            analysis.healthScore < 75 ? 'Moderate optimisation needed.' :
            'Strong SEO foundation — focus on growth.'
          }`,
          title:    scoreContent,
          type:     'gap',
          strength: analysis.healthScore < 50 ? 'Strong' : analysis.healthScore < 75 ? 'Moderate' : 'Weak',
          date:     new Date().toISOString(),
          source:   'SEO Audit',
          addedBy:  'sync',
        });
        added++;
      }
    }

    if (added) write(KEYS.PULSE, existing);
    return added;
  }

  function mapIssueType(issue) {
    const t = (issue.type || issue.category || '').toLowerCase();
    if (t.includes('keyword') || t.includes('content')) return 'message';
    if (t.includes('link')    || t.includes('backlink')) return 'channel';
    if (t.includes('speed')   || t.includes('performance') || t.includes('vitals')) return 'format';
    if (t.includes('technical') || t.includes('crawl') || t.includes('meta')) return 'gap';
    return 'trend';
  }

  // ─── Sync: Strategic Briefs seed (intel_strategic_briefs) ────────────────

  function syncBriefs(project, analysis) {
    if (!project && !analysis) return 0;
    const existing = read(KEYS.BRIEFS);
    if (existing && (Array.isArray(existing) ? existing.length : Object.keys(existing).length > 0)) return 0;

    const topIssues = (analysis?.issues || [])
      .filter(i => i.severity === 'critical' || i.severity === 'high')
      .slice(0, 5)
      .map(i => `- ${i.title || i.type || i.message}`);

    const topKws = (analysis?.keywords || [])
      .slice(0, 5)
      .map(k => (typeof k === 'string' ? k : k.keyword))
      .filter(Boolean);

    const seed = {
      id:        'brief_sync_' + Date.now(),
      title:     project?.projectName ? `${project.projectName} — Initial Campaign Brief` : 'Initial Campaign Brief',
      createdAt: new Date().toISOString(),
      source:    'sync',
      context:   [
        project?.projectName ? `Company: ${project.projectName}` : '',
        project?.websiteUrl  ? `Website: ${project.websiteUrl}`  : '',
        project?.industry    ? `Industry: ${project.industry}`   : '',
        analysis?.healthScore != null ? `SEO Health Score: ${analysis.healthScore}/100` : '',
        topIssues.length ? `\nTop SEO Issues:\n${topIssues.join('\n')}` : '',
        topKws.length    ? `\nKey Opportunities: ${topKws.join(', ')}` : '',
      ].filter(Boolean).join('\n').trim(),
      addedBy:   'sync',
    };

    write(KEYS.BRIEFS, [seed]);
    return 1;
  }

  // ─── Banner ───────────────────────────────────────────────────────────────

  function showBanner(counts) {
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    if (!total) return;

    const lines = [];
    if (counts.radar)  lines.push(`${counts.radar} competitor${counts.radar  > 1 ? 's' : ''}`);
    if (counts.brain)  lines.push('business profile fields');
    if (counts.pulse)  lines.push(`${counts.pulse} market signal${counts.pulse > 1 ? 's' : ''}`);
    if (counts.briefs) lines.push('campaign brief seed');

    const banner = document.createElement('div');
    banner.id = 'intel-sync-banner';
    banner.style.cssText = [
      'position:fixed','bottom:24px','right:24px','z-index:9999',
      'background:linear-gradient(135deg,#1e1b4b,#312e81)',
      'color:#e0e7ff','padding:14px 18px','border-radius:12px',
      'border:1px solid rgba(139,92,246,0.4)','max-width:340px',
      'box-shadow:0 8px 32px rgba(0,0,0,0.4)','font-size:13px',
      'font-family:inherit','line-height:1.5',
    ].join(';');
    banner.innerHTML = `
      <div style="display:flex;align-items:flex-start;gap:10px">
        <span style="font-size:18px;flex-shrink:0">🔗</span>
        <div style="flex:1">
          <div style="font-weight:600;color:#a5b4fc;margin-bottom:4px">Synced from SEO Project</div>
          <div>Auto-imported: ${lines.join(', ')}.</div>
        </div>
        <button onclick="document.getElementById('intel-sync-banner').remove()" style="
          background:none;border:none;color:#a5b4fc;cursor:pointer;font-size:18px;
          padding:0;flex-shrink:0;line-height:1;margin-top:-2px
        ">×</button>
      </div>`;
    document.body.appendChild(banner);
    setTimeout(() => { if (banner.parentNode) banner.remove(); }, 8000);
  }

  // ─── Main ─────────────────────────────────────────────────────────────────

  function run() {
    const project  = read(KEYS.PROJECT);
    const analysis = read(KEYS.ANALYSIS);
    if (!project && !analysis) return;

    // Fingerprint so we skip re-syncing the same data on repeat visits
    const fingerprint = JSON.stringify({
      projId: project?.id || project?.projectName,
      score:  analysis?.healthScore,
      issueN: analysis?.issues?.length,
      compN:  project?.competitors?.length,
      at:     analysis?.analyzedAt,
    });

    const syncState  = read(KEYS.SYNCED) || {};
    const currentPage = window.location.pathname.split('/').pop() || 'index';
    if (syncState[currentPage] === fingerprint) return;

    const counts = {
      radar:  syncRadar(project),
      brain:  syncBrain(project),
      pulse:  syncPulse(analysis),
      briefs: syncBriefs(project, analysis),
    };

    syncState[currentPage] = fingerprint;
    write(KEYS.SYNCED, syncState);

    // Notify pages so they can re-render with the freshly written data
    try {
      document.dispatchEvent(new CustomEvent('intelligence:synced', { detail: counts }));
    } catch (_) {}

    // Show banner after a short delay (lets the page finish its own init first)
    setTimeout(() => showBanner(counts), 700);

    return counts;
  }

  // Export so pages can call IntelligenceSync.run() explicitly if needed
  window.IntelligenceSync = { run };

  // Run synchronously — scripts are at the bottom of <body> so DOM is ready.
  // This ensures data is written to localStorage BEFORE each page's own init
  // function reads it, eliminating the DOMContentLoaded race condition.
  run();

})();
