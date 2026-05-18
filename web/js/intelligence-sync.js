/**
 * intelligence-sync.js
 * Single source of truth bridge: reads SEO project + analysis data and
 * auto-populates the four Intelligence Layer stores without overwriting
 * data the user has already entered.
 *
 * Storage keys read:
 *   seo-current-project-data  → project wizard output
 *   seo-analysis-results      → analysis engine output
 *
 * Storage keys written:
 *   tmd_radar                 → competitive radar competitors
 *   intel_business_brain      → business brain profile
 *   tmd_pulse_signals         → market pulse signals
 *   intel_strategic_briefs    → strategic brief seed data
 *
 * Call IntelligenceSync.run() on each intelligence page load.
 */

(function () {
  'use strict';

  // ─── Constants ─────────────────────────────────────────────────────────────

  const KEYS = {
    PROJECT:  'seo-current-project-data',
    ANALYSIS: 'seo-analysis-results',
    RADAR:    'tmd_radar',
    BRAIN:    'intel_business_brain',
    PULSE:    'tmd_pulse_signals',
    BRIEFS:   'intel_strategic_briefs',
    SYNCED:   'intel_sync_state',   // tracks what was last synced so we can skip re-runs
  };

  // ─── Helpers ────────────────────────────────────────────────────────────────

  function read(key) {
    try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
  }

  function write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {
      console.warn('[IntelligenceSync] write failed:', key, e);
    }
  }

  // ─── Sync: Competitive Radar ─────────────────────────────────────────────────

  function syncRadar(project) {
    if (!project) return 0;
    const rawComps = project.competitors || [];
    if (!rawComps.length) return 0;

    const existing = read(KEYS.RADAR) || [];
    const existingUrls = new Set(existing.map(c => normaliseUrl(c.url)));
    const existingNames = new Set(existing.map(c => (c.name || '').toLowerCase().trim()));

    let added = 0;
    rawComps.forEach(comp => {
      const name = (typeof comp === 'string' ? comp : comp.name || '').trim();
      const url  = (typeof comp === 'string' ? '' : comp.url  || '').trim();
      if (!name && !url) return;

      const normUrl = normaliseUrl(url);
      const normName = name.toLowerCase();

      if ((normUrl && existingUrls.has(normUrl)) || (normName && existingNames.has(normName))) return;

      const entry = {
        id: 'c_sync_' + Date.now() + '_' + added,
        name,
        url,
        moves: [],
        borrowedIdeas: [],
        marketGaps: [],
        addedBy: 'sync',
      };
      existing.push(entry);
      if (normUrl) existingUrls.add(normUrl);
      if (normName) existingNames.add(normName);
      added++;
    });

    if (added) write(KEYS.RADAR, existing);
    return added;
  }

  function normaliseUrl(url) {
    if (!url) return '';
    return url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '').toLowerCase();
  }

  // ─── Sync: Business Brain ───────────────────────────────────────────────────

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
    // companyName at root level (alternative schema used by some pages)
    if (!existing.companyName && project.projectName) {
      existing.companyName = project.projectName;
      changed++;
    }
    if (!existing.website && project.websiteUrl) {
      existing.website = project.websiteUrl;
      changed++;
    }

    if (changed) write(KEYS.BRAIN, existing);
    return changed;
  }

  // ─── Sync: Market Pulse ─────────────────────────────────────────────────────

  function syncPulse(analysis) {
    if (!analysis || !Array.isArray(analysis.issues)) return 0;

    const existing = read(KEYS.PULSE) || [];
    const existingTitles = new Set(existing.map(s => (s.title || '').toLowerCase()));

    const criticalAndHigh = analysis.issues.filter(
      i => i.severity === 'critical' || i.severity === 'high'
    ).slice(0, 10); // cap at 10 signals

    let added = 0;
    criticalAndHigh.forEach(issue => {
      const title = (issue.title || issue.type || issue.message || 'SEO Issue').trim();
      if (existingTitles.has(title.toLowerCase())) return;

      const signal = {
        id: 's_sync_' + Date.now() + '_' + added,
        title,
        description: issue.description || issue.detail || `Detected during SEO audit: ${title}`,
        type: mapIssueType(issue),
        strength: issue.severity === 'critical' ? 'strong' : 'moderate',
        date: new Date().toISOString(),
        source: 'SEO Audit',
        addedBy: 'sync',
      };
      existing.push(signal);
      existingTitles.add(title.toLowerCase());
      added++;
    });

    // Also add a health-score signal if not already present
    const scoreTitle = `Website Health Score: ${analysis.healthScore}/100`;
    if (analysis.healthScore != null && !existingTitles.has(scoreTitle.toLowerCase())) {
      existing.push({
        id: 's_sync_score_' + Date.now(),
        title: scoreTitle,
        description: `Your website scored ${analysis.healthScore}/100 on the last SEO audit. ${analysis.healthScore < 50 ? 'Significant improvement opportunity.' : analysis.healthScore < 75 ? 'Moderate optimisation needed.' : 'Strong foundation — focus on growth.'}`,
        type: 'performance',
        strength: analysis.healthScore < 50 ? 'strong' : analysis.healthScore < 75 ? 'moderate' : 'weak',
        date: new Date().toISOString(),
        source: 'SEO Audit',
        addedBy: 'sync',
      });
      added++;
    }

    if (added) write(KEYS.PULSE, existing);
    return added;
  }

  function mapIssueType(issue) {
    const t = (issue.type || issue.category || '').toLowerCase();
    if (t.includes('keyword') || t.includes('content')) return 'content';
    if (t.includes('link') || t.includes('backlink')) return 'competitive';
    if (t.includes('speed') || t.includes('performance') || t.includes('vitals')) return 'performance';
    if (t.includes('technical') || t.includes('crawl') || t.includes('meta')) return 'technical';
    return 'gap';
  }

  // ─── Sync: Strategic Briefs seed ────────────────────────────────────────────

  function syncBriefs(project, analysis) {
    if (!project && !analysis) return 0;

    const existing = read(KEYS.BRIEFS);
    // Only seed if completely empty
    if (existing && (Array.isArray(existing) ? existing.length : Object.keys(existing).length)) return 0;

    const topIssues = (analysis?.issues || [])
      .filter(i => i.severity === 'critical' || i.severity === 'high')
      .slice(0, 5)
      .map(i => `- ${i.title || i.type || i.message}`);

    const topKws = (analysis?.keywords || [])
      .slice(0, 5)
      .map(k => (typeof k === 'string' ? k : k.keyword))
      .filter(Boolean);

    const seed = {
      id: 'brief_sync_' + Date.now(),
      title: project?.projectName ? `${project.projectName} — Initial Campaign Brief` : 'Initial Campaign Brief',
      createdAt: new Date().toISOString(),
      source: 'sync',
      context: [
        project?.projectName ? `Company: ${project.projectName}` : '',
        project?.websiteUrl  ? `Website: ${project.websiteUrl}`   : '',
        project?.industry    ? `Industry: ${project.industry}`     : '',
        analysis?.healthScore != null ? `SEO Health Score: ${analysis.healthScore}/100` : '',
        topIssues.length ? `\nTop SEO Issues:\n${topIssues.join('\n')}` : '',
        topKws.length    ? `\nKey Opportunities: ${topKws.join(', ')}` : '',
      ].filter(Boolean).join('\n').trim(),
      addedBy: 'sync',
    };

    // Store as an array of briefs (the standard format)
    write(KEYS.BRIEFS, [seed]);
    return 1;
  }

  // ─── Banner ──────────────────────────────────────────────────────────────────

  function showBanner(counts) {
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    if (!total) return;

    const lines = [];
    if (counts.radar)  lines.push(`${counts.radar} competitor${counts.radar > 1 ? 's' : ''}`);
    if (counts.brain)  lines.push(`business profile fields`);
    if (counts.pulse)  lines.push(`${counts.pulse} market signal${counts.pulse > 1 ? 's' : ''}`);
    if (counts.briefs) lines.push(`campaign brief seed`);

    const banner = document.createElement('div');
    banner.id = 'intel-sync-banner';
    banner.style.cssText = [
      'position:fixed', 'bottom:24px', 'right:24px', 'z-index:9999',
      'background:linear-gradient(135deg,#1e1b4b,#312e81)',
      'color:#e0e7ff', 'padding:14px 18px', 'border-radius:12px',
      'border:1px solid rgba(139,92,246,0.4)', 'max-width:340px',
      'box-shadow:0 8px 32px rgba(0,0,0,0.4)', 'font-size:13px',
      'font-family:inherit', 'line-height:1.5',
    ].join(';');

    banner.innerHTML = `
      <div style="display:flex;align-items:flex-start;gap:10px">
        <span style="font-size:18px;flex-shrink:0">🔗</span>
        <div style="flex:1">
          <div style="font-weight:600;color:#a5b4fc;margin-bottom:4px">Synced from SEO Project</div>
          <div>Auto-imported: ${lines.join(', ')}.</div>
        </div>
        <button onclick="this.closest('#intel-sync-banner').remove()" style="
          background:none;border:none;color:#a5b4fc;cursor:pointer;
          font-size:16px;padding:0;flex-shrink:0;line-height:1
        ">×</button>
      </div>`;

    document.body.appendChild(banner);
    setTimeout(() => { if (banner.parentNode) banner.remove(); }, 8000);
  }

  // ─── Main entry point ────────────────────────────────────────────────────────

  function run() {
    const project  = read(KEYS.PROJECT);
    const analysis = read(KEYS.ANALYSIS);

    if (!project && !analysis) return; // nothing to sync from

    // Build a fingerprint to avoid re-running identical data on every page load
    const fingerprint = JSON.stringify({
      projId:  project?.id || project?.projectName,
      score:   analysis?.healthScore,
      issueN:  analysis?.issues?.length,
      compN:   project?.competitors?.length,
      at:      analysis?.analyzedAt,
    });

    const syncState = read(KEYS.SYNCED) || {};
    const currentPage = window.location.pathname.split('/').pop() || 'index';
    if (syncState[currentPage] === fingerprint) return; // already synced this data on this page

    const counts = {
      radar:  syncRadar(project),
      brain:  syncBrain(project),
      pulse:  syncPulse(analysis),
      briefs: syncBriefs(project, analysis),
    };

    // Persist fingerprint for this page
    syncState[currentPage] = fingerprint;
    write(KEYS.SYNCED, syncState);

    // Show banner (deferred so page can finish rendering first)
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => showBanner(counts));
    } else {
      setTimeout(() => showBanner(counts), 600);
    }

    return counts;
  }

  // ─── Export ──────────────────────────────────────────────────────────────────

  window.IntelligenceSync = { run };

  // Auto-run when script loads (pages can call IntelligenceSync.run() explicitly
  // if they need to wait for their own init first, but auto-run handles most cases)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }

})();
