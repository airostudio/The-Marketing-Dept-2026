/**
 * compliance-mission.js — runs Compliance Guard's real screen as the last
 * step of a Scotty mission: it reads what the mission's other agents produced
 * (still waiting for approval) plus anything pasted, and reports findings that
 * each quote the exact words they are about.
 *
 * It changes no content and approves nothing. An output with a critical
 * finding then asks the person to confirm they have read it before approving.
 * A screen, not legal advice.
 */
(function (root) {
  'use strict';

  const REGIONS = ['US', 'UK', 'EU', 'AU', 'CA', 'Global'];
  // Agents whose real output the screen can read.
  const PRODUCERS = ['delivery', 'social', 'nancy', 'ads', 'seo', 'linkedin', 'video'];
  const NAMES = { delivery: 'Pat\'s email', social: 'Social Studio posts', nancy: 'Nancy\'s Instagram week', ads: 'ad copy', seo: 'SEO articles', linkedin: 'LinkedIn drafts', video: 'the video clip' };

  function sanitizeParams(p) {
    const src = (p && typeof p === 'object') ? p : {};
    return {
      region: REGIONS.includes(src.region) ? src.region : 'Global',
      content: String(src.content == null ? '' : src.content).replace(/\r\n?/g, '\n').trim().slice(0, 12000),
    };
  }

  function describeParams(params, producers) {
    const what = (producers || []).map(k => NAMES[k]).filter(Boolean);
    const parts = [];
    if (what.length) parts.push(what.join(', '));
    if (params.content) parts.push('the pasted content');
    return `Screen ${parts.length ? parts.join(' and ') : '[nothing yet — paste the content to check]'} for ${params.region === 'Global' ? 'general' : params.region} advertising, privacy and brand-safety risk. A screen, not legal advice.`;
  }

  /** Something has to be screened: another agent's output in this mission, or pasted content. */
  function missingInputs(params, producers) {
    return (sanitizeParams(params).content || (producers || []).some(k => PRODUCERS.includes(k))) ? [] : ['the content to check (this mission has no other agent producing any)'];
  }

  /**
   * @param {object} task  { params: {region, content} }
   * @param {object} opts  { authHeaders, intelProfileId, projectId, missionId, industry, neverSay, competitorNames, onStatus, fetchImpl }
   */
  async function runCompliance(task, opts) {
    const o = opts || {};
    const doFetch = o.fetchImpl || ((...a) => fetch(...a));
    const params = sanitizeParams(task.params);
    if (task._complianceState) return task._complianceState;

    if (o.onStatus) o.onStatus('Screening this mission\'s content…');
    const res = await doFetch('/api/mission-compliance', {
      method: 'POST', headers: await o.authHeaders(),
      body: JSON.stringify({
        action: 'review', region: params.region, content: params.content,
        industry: o.industry || '', neverSay: o.neverSay || [], competitorNames: o.competitorNames || [],
        missionId: o.missionId || undefined, projectId: o.projectId || undefined, intelProfileId: o.intelProfileId || undefined,
      }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error((data && data.error) || `Compliance Guard request failed (HTTP ${res.status})`);
    if (data.status === 'needs_input') throw new Error(`Compliance Guard needs more from you: ${(data.questions || []).map(q => q.question).join(' ')}`);
    task._complianceState = {
      artifactId: data.artifactId, region: data.region, counts: data.counts || {}, pieces: data.pieces || [], findings: data.findings || [],
      reviewed: data.reviewed || [], unmarked: data.unmarked || [], droppedUnverified: data.droppedUnverified || 0,
      skippedPieces: data.skippedPieces || 0, reviewError: data.reviewError || null, complete: true,
    };
    return task._complianceState;
  }

  const VERDICT = { needs_changes: 'needs changes', check_warnings: 'check the warnings', no_issues_found: 'no issues found by this screen', rules_only: 'rule checks only' };

  function describeResult(r) {
    const c = r.counts || {};
    const lines = [`**Compliance Guard screened ${r.pieces.length} piece${r.pieces.length === 1 ? '' : 's'} of this mission's content for real** (${r.region}): ${c.critical || 0} critical, ${c.warnings || 0} warning${c.warnings === 1 ? '' : 's'}, ${c.suggestions || 0} suggestion${c.suggestions === 1 ? '' : 's'}. Every finding quotes the words it is about.`, ''];
    r.pieces.forEach(p => lines.push(`- **${p.label}** — ${VERDICT[p.verdict] || p.verdict}`));
    if (r.reviewError) lines.push('', `⚠️ The judgement review could not run (${r.reviewError}); only the rule checks were applied, so "nothing found" is not a clean bill.`);
    if (r.droppedUnverified) lines.push('', `${r.droppedUnverified} further finding${r.droppedUnverified === 1 ? ' was' : 's were'} left out because ${r.droppedUnverified === 1 ? 'it' : 'they'} did not quote words that are actually in the content.`);
    if (r.skippedPieces) lines.push('', `${r.skippedPieces} piece${r.skippedPieces === 1 ? ' was' : 's were'} too much to screen in one go and ${r.skippedPieces === 1 ? 'was' : 'were'} not checked.`);
    if (c.critical) lines.push('', 'Outputs with a critical finding will ask you to confirm you have read it before they can be approved.');
    lines.push('', 'Nothing was changed or approved. This is an AI-assisted screen, not legal advice — have a lawyer review anything with real legal exposure.');
    return lines.join('\n');
  }

  const api = { runCompliance, sanitizeParams, describeParams, missingInputs, describeResult, REGIONS, PRODUCERS, VERDICT };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ComplianceMission = api;
})(typeof window !== 'undefined' ? window : globalThis);
