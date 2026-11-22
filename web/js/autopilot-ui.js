/**
 * autopilot-ui.js — small helpers shared by the Connections, SEO Autopilot
 * and "What happened" pages: element lookup, HTML escaping, the signed-in
 * API call (our own outages reach the admin console), and which business is
 * active.
 */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const safeHref = (u) => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : ''; } catch { return ''; } };

  async function call(path, body) {
    const res = await fetch(path, { method: 'POST', headers: await window.sendAuthHeaders(), body: JSON.stringify(body) });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const e = new Error((data && data.error) || `HTTP ${res.status}`); e.data = data; e.status = res.status;
      if (res.status >= 500 && window.reportFailure) window.reportFailure(`${path} ${body && body.action} failed: ${e.message}`, { where: location.pathname, status: res.status });
      throw e;
    }
    return data;
  }

  function scope() {
    const get = (k) => { try { const v = localStorage.getItem(k); return v && !String(v).startsWith('local_') ? v : null; } catch { return null; } };
    const intelProfileId = get('intel_active_profile');
    return intelProfileId ? { intelProfileId } : (get('seo-current-project') ? { projectId: get('seo-current-project') } : {});
  }

  window.AutopilotUI = { $, esc, safeHref, call, scope };
})();
