/**
 * api/_lib/autopilot/connections.js — load a business's connection with its
 * secret opened, only inside the server and only when an agent acts on it.
 * Any failure to use it is an 'auth' fault, so the runner asks the business
 * to reconnect rather than guessing.
 */

'use strict';

const box = require('../secret-box.js');

/** The safe-to-show view of a connection (never the secret). */
function publicView(c) {
  return {
    id: c.id, provider: c.provider, label: c.label, siteUrl: c.site_url, status: c.status, statusNote: c.status_note,
    lastOkAt: c.last_ok_at, lastErrorAt: c.last_error_at, createdAt: c.created_at,
    intelProfileId: c.intel_profile_id, projectId: c.project_id,
    // A Facebook sign-in can manage several Pages, a Google one several Search Console sites: which one is used.
    choice: c.provider === 'facebook' ? { label: 'Page', value: (c.config || {}).pageId, options: ((c.config || {}).pages || []).map(p => ({ value: p.id, label: p.name })) }
      : c.provider === 'gsc' ? { label: 'Site', value: (c.config || {}).property, options: ((c.config || {}).properties || []).map(p => ({ value: p, label: p.replace(/^sc-domain:/, '') })) }
      : null,
  };
}

async function load(sb, id) {
  const r = await sb('GET', `/connections?id=eq.${id}&select=*&limit=1`);
  const c = r.ok && r.data && r.data[0];
  if (!c) { const e = new Error('The connection was removed.'); e.kind = 'auth'; e.connectionId = id; throw e; }
  if (c.status !== 'active') { const e = new Error(c.status_note || 'The connection needs attention.'); e.kind = 'auth'; e.connectionId = id; e.connectionLabel = c.label; throw e; }
  let secret;
  try { secret = c.secret_enc ? box.open(c.secret_enc) : {}; }
  catch (err) { if (err.kind === 'not_configured') throw err; err.connectionId = id; err.connectionLabel = c.label; throw err; }
  return { ...c, secret };
}

module.exports = { load, publicView };
