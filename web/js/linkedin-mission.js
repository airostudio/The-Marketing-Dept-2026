/**
 * linkedin-mission.js — runs LinkedIn Outreach's real drafting as a Scotty
 * mission step, and files the approved drafts against the prospects on the
 * LinkedIn Outreach page.
 *
 * Nothing here touches LinkedIn. LinkedIn's terms forbid automating connection
 * requests and messages, so Audema writes the drafts and a person sends them.
 * The people come from the goal, from what the user types, or from the
 * prospect list already kept on the LinkedIn Outreach page — never from a
 * search of LinkedIn.
 */
(function (root) {
  'use strict';

  const STORE_KEY = 'mex_prospects_v1';          // the LinkedIn Outreach page's own prospect list
  const MARKER = 'Scotty draft ready';           // notes starting with this are our own output, never fed back in as facts
  const MAX_PROSPECTS = 10;

  const clean = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);

  function liUrl(v) {
    try { const u = new URL(String(v || '').trim()); return u.protocol === 'https:' && /(^|\.)linkedin\.com$/i.test(u.hostname) && /^\/in\//i.test(u.pathname) ? u.origin + u.pathname : ''; } catch { return ''; }
  }

  /** "Name, Title, Company, linkedin.com/in/…" per line (extra commas in a title are not supported). */
  function parseProspectLines(text) {
    return String(text || '').split('\n').map(l => l.trim()).filter(Boolean).map(l => {
      const parts = l.split(',').map(x => x.trim());
      const urlAt = parts.findIndex(x => /linkedin\.com\/in\//i.test(x));
      const url = urlAt >= 0 ? parts[urlAt] : '';
      const rest = parts.filter((x, i) => i !== urlAt);
      return { name: rest[0] || '', title: rest[1] || '', company: rest[2] || '', linkedinUrl: url && !/^https?:\/\//i.test(url) ? 'https://' + url : url };
    });
  }

  function sanitizeParams(p) {
    const src = (p && typeof p === 'object') ? p : {};
    const raw = Array.isArray(src.prospects) ? src.prospects : parseProspectLines(src.prospects);
    const seen = new Set(); const prospects = [];
    for (const r of raw) {
      const name = clean(r && r.name, 80);
      if (!name) continue;
      const key = (name + '|' + clean(r.company, 100)).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      prospects.push({ clientId: r.clientId != null ? clean(r.clientId, 60) : undefined, name, title: clean(r.title, 100), company: clean(r.company, 100), note: clean(r.note, 400), linkedinUrl: liUrl(r.linkedinUrl) });
      if (prospects.length >= MAX_PROSPECTS) break;
    }
    return { prospects, offer: clean(src.offer, 400) };
  }

  function describeParams(params) {
    return `Draft a LinkedIn connection note and follow-up for ${params.prospects.length || '[no]'} ${params.prospects.length === 1 ? 'person' : 'people'}, offering: ${params.offer || '[offer]'}`;
  }

  function missingInputs(params) {
    const p = sanitizeParams(params);
    const m = [];
    if (!p.prospects.length) m.push('who the messages are for (LinkedIn Outreach will not search LinkedIn for people)');
    if (!p.offer) m.push('what you are offering them');
    return m;
  }

  /** Prospects already on the LinkedIn Outreach page, as facts. Our own earlier drafts are not facts. */
  function readStoredProspects(storage) {
    try {
      const s = storage || root.localStorage;
      return (JSON.parse(s.getItem(STORE_KEY) || '[]') || [])
        .filter(p => p && p.name && (p.status || 'new') === 'new')
        .map(p => ({ clientId: p.id, name: p.name, title: p.title || '', company: p.company || '', linkedinUrl: p.linkedinUrl || '', note: String(p.notes || '').startsWith(MARKER) ? '' : (p.notes || '') }));
    } catch { return []; }
  }

  /**
   * @param {object} task  { params: {prospects, offer} }
   * @param {object} opts  { authHeaders, intelProfileId, projectId, missionId, sender: {senderName, senderTitle, companyName}, language, onStatus, fetchImpl }
   */
  async function runLinkedInDrafts(task, opts) {
    const o = opts || {};
    const doFetch = o.fetchImpl || ((...a) => fetch(...a));
    const params = sanitizeParams(task.params);
    const missing = missingInputs(params);
    if (missing.length) throw new Error(`LinkedIn Outreach needs ${missing.join(' and ')} before it can write.`);
    if (task._linkedinState) return task._linkedinState;

    if (o.onStatus) o.onStatus(`Writing messages for ${params.prospects.length} ${params.prospects.length === 1 ? 'person' : 'people'}…`);
    const res = await doFetch('/api/mission-linkedin', {
      method: 'POST', headers: await o.authHeaders(),
      body: JSON.stringify({
        action: 'draft', prospects: params.prospects, offer: params.offer, ...(o.sender || {}), language: o.language || '',
        projectId: o.projectId || undefined, intelProfileId: o.intelProfileId || undefined, missionId: o.missionId || undefined,
      }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error((data && data.error) || `LinkedIn Outreach request failed (HTTP ${res.status})`);
    if (data.status === 'needs_input') throw new Error(`LinkedIn Outreach needs more from you: ${(data.questions || []).map(q => q.question).join(' ')}`);
    task._linkedinState = { artifactId: data.artifactId, status: data.status, drafts: data.drafts || [], usable: data.usable || 0, note: data.note || null, complete: true };
    return task._linkedinState;
  }

  function describeResult(r) {
    if (!r.usable) return `**LinkedIn Outreach wrote drafts for real** — ${r.note || 'none passed the checks.'}`;
    const lines = [`**LinkedIn Outreach wrote drafts for ${r.drafts.length} ${r.drafts.length === 1 ? 'person' : 'people'} for real**; ${r.usable} passed every check.`, ''];
    r.drafts.forEach(d => lines.push(`- **${d.name}**${d.company ? ` (${d.company})` : ''}: ${d.usable ? 'ready' : 'left out — ' + d.problems.join(' ')}`));
    lines.push('', 'Waiting for your approval. Nothing has been sent and nothing touches LinkedIn: LinkedIn forbids automated messages, so you send these by hand.');
    return lines.join('\n');
  }

  /**
   * File approved drafts on the LinkedIn Outreach page's prospect list. A
   * prospect is matched by the id it came from, else by name + company; a
   * person who was only typed into the mission is added. Existing notes are
   * kept and our block is appended once.
   * @returns {{updated:number, added:number}}
   */
  function mergeApprovedDrafts(drafts, storage) {
    const s = storage || root.localStorage;
    let list = [];
    try { list = JSON.parse(s.getItem(STORE_KEY) || '[]') || []; } catch { list = []; }
    let updated = 0, added = 0;
    for (const d of drafts || []) {
      const block = `${MARKER} —\nConnection note: ${d.connectionNote}\nFollow-up after they accept: ${d.followUp}`;
      let p = list.find(x => d.clientId != null && String(x.id) === String(d.clientId)) || list.find(x => x.name === d.name && (x.company || '') === (d.company || ''));
      if (p) {
        // Our block is replaced, never stacked; anything the user wrote before it is kept.
        const at = String(p.notes || '').indexOf(MARKER);
        const prior = (at >= 0 ? String(p.notes).slice(0, at) : String(p.notes || '')).trim();
        p.notes = prior ? prior + '\n\n' + block : block;
        updated++;
      } else {
        list.push({ id: Date.now() + Math.random(), name: d.name, title: d.title || '', company: d.company || '', linkedinUrl: d.linkedinUrl || '', email: '', addedAt: new Date().toISOString(), status: 'new', notes: block });
        added++;
      }
    }
    s.setItem(STORE_KEY, JSON.stringify(list));
    return { updated, added };
  }

  const api = { runLinkedInDrafts, sanitizeParams, describeParams, missingInputs, describeResult, parseProspectLines, readStoredProspects, mergeApprovedDrafts, MARKER, STORE_KEY, MAX_PROSPECTS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LinkedInMission = api;
})(typeof window !== 'undefined' ? window : globalThis);
