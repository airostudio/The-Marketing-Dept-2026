/**
 * settings-editor.js — the list of third-party keys and options, grouped,
 * showing where each value comes from (this client / the platform / Vercel /
 * not set) and letting an admin set or clear it. Used by the admin Settings
 * page and the client owner's Settings page. Values never come back from the
 * server; a secret shows only its last four characters.
 *
 *   SettingsEditor.mount(el, { api, workspaceId })   api(payload) → Promise<json>
 */
(function () {
  'use strict';
  const esc = window.escapeHtml || ((v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
  const SOURCE = {
    workspace: ['This client\'s own', 'ok'],
    platform: ['Platform default', 'plat'],
    env: ['From Vercel', 'env'],
    null: ['Not set', 'none'],
  };
  const STYLE = `
    .se-group { margin-bottom:18px; }
    .se-group h3 { font-size:12px; text-transform:uppercase; letter-spacing:.5px; color:var(--text2,#94a3b8); margin:0 0 8px; }
    .se-row { display:grid; grid-template-columns:minmax(200px,1.1fr) minmax(220px,1.4fr) auto; gap:10px; align-items:start; padding:10px 0; border-top:1px solid var(--border,rgba(255,255,255,.09)); }
    .se-row .lbl { font-weight:600; font-size:13px; }
    .se-row .help { color:var(--text3,#64748b); font-size:12px; line-height:1.5; margin-top:2px; }
    .se-row .key { color:var(--text3,#64748b); font-size:11px; font-family:ui-monospace,monospace; }
    .se-row input, .se-row textarea { width:100%; background:var(--panel2,#15152a); border:1px solid var(--border,rgba(255,255,255,.09)); border-radius:8px; color:inherit; padding:8px 10px; font:inherit; font-size:13px; }
    .se-pill { display:inline-block; font-size:10.5px; font-weight:700; padding:2px 8px; border-radius:99px; text-transform:uppercase; letter-spacing:.3px; margin-top:6px; }
    .se-pill.ok { background:rgba(34,197,94,.15); color:#86efac; } .se-pill.plat { background:rgba(124,58,237,.18); color:#c4b5fd; }
    .se-pill.env { background:rgba(6,182,212,.15); color:#67e8f9; } .se-pill.none { background:rgba(255,255,255,.06); color:#94a3b8; }
    .se-actions { display:flex; gap:6px; }
    .se-actions button { padding:7px 12px; font-size:12px; }
    @media (max-width:760px) { .se-row { grid-template-columns:1fr; } }`;

  function mount(el, { api, workspaceId = null, onSaved } = {}) {
    if (!document.getElementById('se-style')) { const st = document.createElement('style'); st.id = 'se-style'; st.textContent = STYLE; document.head.appendChild(st); }
    let filter = '';

    async function load() {
      el.innerHTML = '<p class="muted">Loading…</p>';
      try { render(await api({ action: 'get', workspaceId: workspaceId || undefined })); }
      catch (e) { el.innerHTML = `<div class="msg error">${esc(e.message)}</div>`; }
    }

    function render(d) {
      const groups = [];
      for (const it of d.items) { let g = groups.find(x => x.name === it.group); if (!g) groups.push(g = { name: it.group, items: [] }); g.items.push(it); }
      const setCount = d.items.filter(i => i.own).length;
      el.innerHTML = `${d.encryptionConfigured ? '' : '<div class="msg error">CONNECTIONS_ENCRYPTION_KEY isn\'t set in Vercel, so settings can\'t be saved yet.</div>'}
        <div class="filters"><input data-se-filter placeholder="Find a setting…" value="${esc(filter)}" style="max-width:280px"><span class="muted">${setCount} set ${d.scope === 'workspace' ? 'for this client' : 'as platform defaults'} · ${d.scope === 'workspace' ? 'anything left blank uses the platform default' : 'anything left blank uses the Vercel value, if there is one'}</span></div>
        ${groups.map(g => `<div class="se-group"><h3>${esc(g.name)}</h3>${g.items.map(row).join('')}</div>`).join('')}`;
      applyFilter();
    }

    function row(it) {
      const [label, cls] = SOURCE[it.source] || SOURCE.null;
      const multiline = it.key === 'GOOGLE_SERVICE_ACCOUNT_JSON';
      const placeholder = it.own ? (it.secret ? `Saved (${it.hint || 'hidden'}) — type to replace` : '') : (it.source === 'platform' ? 'Using the platform default' : it.source === 'env' ? 'Using the Vercel value' : '');
      const input = multiline
        ? `<textarea data-se-input="${esc(it.key)}" rows="3" placeholder="${esc(placeholder)}"></textarea>`
        : `<input data-se-input="${esc(it.key)}" type="${it.secret ? 'password' : 'text'}" autocomplete="off" placeholder="${esc(placeholder)}" value="${it.own && !it.secret ? esc(it.hint || '') : ''}">`;
      return `<div class="se-row" data-se-row="${esc((it.label + ' ' + it.key + ' ' + it.group).toLowerCase())}">
        <div><div class="lbl">${esc(it.label)}</div><div class="key">${esc(it.key)}</div>${it.help ? `<div class="help">${esc(it.help)}</div>` : ''}<span class="se-pill ${cls}">${esc(label)}${it.hint && it.secret && it.source !== 'env' ? ` ${esc(it.hint)}` : ''}</span></div>
        <div>${input}</div>
        <div class="se-actions"><button data-se-save="${esc(it.key)}">Save</button>${it.own ? `<button class="ghost" data-se-clear="${esc(it.key)}">Clear</button>` : ''}</div>
      </div>`;
    }

    function applyFilter() {
      el.querySelectorAll('[data-se-row]').forEach(r => { r.style.display = !filter || r.dataset.seRow.includes(filter.toLowerCase()) ? '' : 'none'; });
    }

    el.addEventListener('input', (ev) => { if (ev.target.matches('[data-se-filter]')) { filter = ev.target.value; applyFilter(); } });
    el.addEventListener('click', async (ev) => {
      const b = ev.target.closest('button[data-se-save],button[data-se-clear]'); if (!b) return;
      const key = b.dataset.seSave || b.dataset.seClear;
      const value = b.dataset.seSave ? el.querySelector(`[data-se-input="${CSS.escape(key)}"]`).value : '';
      if (b.dataset.seSave && !value.trim()) { alert('Type a value first (or use Clear to remove it).'); return; }
      if (b.dataset.seClear && !confirm('Clear this? It falls back to the next source (platform default or Vercel).')) return;
      b.disabled = true;
      try { render(await api({ action: 'set', workspaceId: workspaceId || undefined, key, value })); if (onSaved) onSaved(key); }
      catch (e) { alert(e.message); b.disabled = false; }
    });
    load();
    return { reload: load };
  }

  window.SettingsEditor = { mount };
})();
