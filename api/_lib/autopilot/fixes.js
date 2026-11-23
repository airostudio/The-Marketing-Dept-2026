/**
 * api/_lib/autopilot/fixes.js — Site fixes: on its schedule, reads the
 * business's live pages, writes fixes for weak or missing titles, meta
 * descriptions and image alt text, and — once the business has ticked the
 * ones it wants — applies them on the website where the platform allows,
 * handing the rest over ready to paste.
 *
 *   scan     the home page plus the site's own posts and pages (≤ 12)
 *   propose  fixes written from each page's own words / each image (page-fixes.js)
 *   decide   always asks: it changes live pages. The business can untick or
 *            edit any fix first.
 *   apply    one fix at a time, remembering which are done, so a retry
 *            after a hiccup never repeats one
 */

'use strict';

const cms = require('../cms.js');
const pf = require('../page-fixes.js');
const { safeFetchText } = require('../safe-fetch.js');
const connections = require('./connections.js');

const str = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
const scopeFilter = (ap) => (ap.intel_profile_id ? `intel_profile_id=eq.${ap.intel_profile_id}` : ap.project_id ? `project_id=eq.${ap.project_id}` : `user_id=eq.${ap.user_id}`);
const MAX_PAGES = 12;
const LABEL = { title: 'Title', meta: 'Meta description', alt: 'Alt text' };
function fault(m, kind) { const e = new Error(m); e.kind = kind; return e; }

async function siteConnection(sb, ap) {
  if (ap.connection_id) return ap.connection_id;
  const r = await sb('GET', `/connections?${scopeFilter(ap)}&provider=in.(wordpress,webflow,shopify,wix,godaddy)&status=neq.disconnected&select=id&order=created_at.desc&limit=1`);
  return (r.ok && r.data && r.data[0] && r.data[0].id) || null;
}

const fixes = {
  agent: 'fixes', kind: 'site_fixes', firstStep: 'scan', label: 'Site fixes', approvalOnly: true, jobApproval: true,
  cleanSettings(s) {
    const src = (s && typeof s === 'object') ? s : {};
    return { types: ['title', 'meta', 'alt'].filter(t => !Array.isArray(src.types) || src.types.includes(t)) };
  },
  steps: {
    async scan({ sb, autopilot, deps }) {
      if (!autopilot) throw fault('This job has no autopilot settings.', 'permanent');
      const connId = await siteConnection(sb, autopilot);
      if (!connId) return { wait: 'permission', resume: 'scan', event: { title: 'Site fixes needs your website connected', body: 'Connect your WordPress, Webflow, Shopify, Wix or GoDaddy site under Connections and it checks your pages straight away.', action: { type: 'connect', provider: 'website' } } };
      const conn = await connections.load(sb, connId);
      const provider = (deps.providers || cms.PROVIDERS)[conn.provider];
      if (!conn.site_url) throw fault('The connection has no website address. Reconnect it with the address.', 'permanent');
      const listed = await provider.listPages(conn, deps).catch(() => []);
      const urls = [...new Set([conn.site_url.replace(/\/+$/, '') + '/', ...listed.map(p => p.url)].filter(u => { try { return new URL(u).origin === new URL(conn.site_url).origin; } catch { return false; } }))].slice(0, MAX_PAGES);
      const fetchText = deps.fetchText || safeFetchText;
      const types = fixes.cleanSettings(autopilot.settings).types;
      const pages = []; let unreadable = 0;
      for (const u of urls) {
        try {
          const r = await fetchText(u, { maxBytes: 800000, timeoutMs: 15000 });
          if (r.status >= 400 || !r.text) { unreadable++; continue; }
          const p = pf.scanPage(r.text, u);
          p.issues = p.issues.filter(x => types.includes(x.type));
          if (p.issues.length) pages.push(p);
        } catch { unreadable++; }
      }
      if (unreadable === urls.length) throw fault(`None of the pages on ${conn.site_url} could be read.`, 'site_unreachable');
      if (!pages.length) return { done: { checked: urls.length, fixes: 0 }, event: { kind: 'info', title: `Site fixes: ${urls.length} pages checked, nothing to fix`, body: 'Every page checked has a title and meta description of a good length, and every image has alt text.' } };
      return { next: 'propose', state: { connectionId: conn.id, provider: conn.provider, checked: urls.length, pages: pages.map(p => ({ url: p.url, title: p.title, metaDescription: p.metaDescription, h1: p.h1, text: p.text, issues: p.issues })) } };
    },

    async propose({ state, sb, autopilot, deps }) {
      const run = await sb('GET', `/seo_runs?${scopeFilter(autopilot)}&select=business_summary&order=created_at.desc&limit=1`);
      const name = (run.ok && run.data && run.data[0] && str(run.data[0].business_summary, 120)) || '';
      const list = await pf.propose(state.pages, { businessName: name, neverSay: (autopilot.settings && autopilot.settings.neverSay) || [] }, deps);
      if (!list.length) return { done: { checked: state.checked, fixes: 0 }, event: { kind: 'info', title: 'Site fixes found problems but no fix it could stand behind', body: `${state.pages.reduce((n, p) => n + p.issues.length, 0)} problems were found, but none of the suggested fixes could be backed up by what your pages say, so nothing is proposed. It tries again next time.` } };
      const applyFn = pf.makeApply(cms)[state.provider];
      // Which ones the platform lets us apply is only known for sure when trying; this is the expectation shown up front.
      const autoTypes = { wordpress: ['alt', 'title', 'meta'], shopify: ['title', 'meta', 'alt'], webflow: ['title', 'meta'], wix: [], godaddy: [] }[state.provider] || [];
      return { next: 'decide', state: { fixes: list.map(f => ({ ...f, auto: !!applyFn && autoTypes.includes(f.type) })), pages: undefined } };
    },

    async decide({ state, job }) {
      const n = state.fixes.length, auto = state.fixes.filter(f => f.auto).length;
      const byType = ['title', 'meta', 'alt'].map(t => [t, state.fixes.filter(f => f.type === t).length]).filter(([, c]) => c).map(([t, c]) => `${c} ${LABEL[t].toLowerCase()}${c === 1 ? '' : 's'}`).join(', ');
      return {
        wait: 'approval', resume: 'apply',
        event: {
          title: `Site fixes ready for your OK: ${n} fix${n === 1 ? '' : 'es'} on ${state.checked} pages`,
          body: `${byType}. Each was written from the page's own words${state.fixes.some(f => f.type === 'alt') ? ' (alt text from looking at the image)' : ''}. Untick or edit any before approving.\n\n${auto ? `${auto} can be changed on your site automatically` : 'Your platform doesn\'t let apps change these'}${auto < n ? `; ${n - auto} will be handed to you ready to paste` : ''}.`,
          action: { type: 'fixes', jobId: job.id },
        },
      };
    },

    async apply({ state, sb, deps }) {
      const conn = await connections.load(sb, state.connectionId);
      const applyFn = (deps.applyFixes || pf.makeApply(cms))[conn.provider];
      const results = { ...(state.results || {}) };
      for (const f of state.fixes.filter(x => x.include && !results[x.id])) {
        try {
          const r = await applyFn(conn, f, deps);
          results[f.id] = { ok: true, note: r && r.note };
        } catch (e) {
          if (e.kind === 'unsupported' || e.kind === 'permanent') { results[f.id] = { ok: false, manual: true, reason: e.message }; continue; }
          // A hiccup or a refused login: keep what's done, and let the runner retry or ask.
          e.connectionId = conn.id; e.connectionLabel = conn.label;
          e.stateUpdate = { results };
          throw e;
        }
      }
      const done = state.fixes.filter(f => results[f.id] && results[f.id].ok);
      const manual = state.fixes.filter(f => results[f.id] && results[f.id].manual);
      const skipped = state.fixes.filter(f => !f.include).length;
      const path = (u) => { try { return new URL(u).pathname || '/'; } catch { return u; } };
      const body = [
        done.length ? `Changed on ${conn.label}:\n${done.map(f => `• ${path(f.page)} — ${LABEL[f.type]}: "${f.value}"`).join('\n')}` : '',
        manual.length ? `\nTo paste yourself (${[...new Set(manual.map(f => results[f.id].reason))].join(' ')}):\n${manual.map(f => `• ${path(f.page)}${f.src ? ` (${path(f.src)})` : ''} — ${LABEL[f.type]}: ${f.value}`).join('\n')}` : '',
        skipped ? `\n${skipped} you unticked ${skipped === 1 ? 'was' : 'were'} left as they are.` : '',
        done.some(f => f.type !== 'alt') && conn.provider === 'webflow' ? '\nPublish your site in Webflow for the changes to go live.' : '',
      ].filter(Boolean).join('\n');
      return { done: { applied: done.length, manual: manual.length, skipped }, state: { results }, event: { kind: 'done', title: `Site fixes: ${done.length} applied${manual.length ? `, ${manual.length} to paste` : ''}`, body, action: { type: 'link', href: '/autopilot.html#fixes' } } };
    },
  },
  stepLabel: (s) => ({ scan: 'reading your pages', propose: 'writing the fixes', decide: 'asking for your OK', apply: 'changing your pages' }[s] || s),
};

module.exports = fixes;
