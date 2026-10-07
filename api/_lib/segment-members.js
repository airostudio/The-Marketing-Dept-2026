/**
 * api/_lib/segment-members.js — who is in a segment right now, resolved on the
 * server with the service key. Mirrors web/js/contacts-store.js
 * resolveSegmentContacts() (which runs in the browser under RLS), including
 * its rule that only 'subscribed' contacts are ever returned, whatever a
 * segment's saved rules say.
 *
 * Always scoped to the owner's own contacts: a segment id belonging to someone
 * else resolves to nothing, never to their audience.
 */

'use strict';

const MAX_MEMBERS = 2000;
const ID_CHUNK = 100;

/** A Postgres array literal for PostgREST cs./ov. filters: {"a","b"}, URL-encoded. */
function pgArray(tags) {
  const quoted = tags.map(t => '"' + String(t).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"');
  return encodeURIComponent('{' + quoted.join(',') + '}');
}

/**
 * @param {Function} sb  (method, path, body) => {ok,status,data}
 * @returns {Promise<{ok:true, segment, contacts: Array<{id,email,status}>} | {ok:false, code, error}>}
 */
async function resolveSegment(sb, ownerId, segmentId) {
  const sr = await sb('GET', `/segments?id=eq.${encodeURIComponent(segmentId)}&user_id=eq.${ownerId}&limit=1`);
  if (!sr.ok) return { ok: false, code: 'segment_unreadable', error: `Could not read the segment (HTTP ${sr.status}).` };
  const segment = sr.data && sr.data[0];
  if (!segment) return { ok: false, code: 'segment_missing', error: 'The segment this flow watches no longer exists (or is not this account\'s).' };

  if (segment.member_mode === 'static') {
    const mr = await sb('GET', `/segment_members?segment_id=eq.${segment.id}&select=contact_id&limit=${MAX_MEMBERS}`);
    if (!mr.ok) return { ok: false, code: 'segment_unreadable', error: `Could not read the segment members (HTTP ${mr.status}).` };
    const ids = (mr.data || []).map(r => r.contact_id).filter(Boolean);
    const contacts = [];
    for (let i = 0; i < ids.length; i += ID_CHUNK) {
      const chunk = ids.slice(i, i + ID_CHUNK);
      const cr = await sb('GET', `/contacts?user_id=eq.${ownerId}&status=eq.subscribed&id=in.(${chunk.join(',')})&select=id,email,status`);
      if (!cr.ok) return { ok: false, code: 'segment_unreadable', error: `Could not read the members' contacts (HTTP ${cr.status}).` };
      contacts.push(...(cr.data || []));
    }
    return { ok: true, segment, contacts };
  }

  const rules = segment.filter_rules || {};
  let path = `/contacts?user_id=eq.${ownerId}&status=eq.subscribed&select=id,email,status&limit=${MAX_MEMBERS}`;
  if (Array.isArray(rules.tagsAny) && rules.tagsAny.length) path += `&tags=ov.${pgArray(rules.tagsAny)}`;
  if (Array.isArray(rules.tagsAll) && rules.tagsAll.length) path += `&tags=cs.${pgArray(rules.tagsAll)}`;
  const cr = await sb('GET', path);
  if (!cr.ok) return { ok: false, code: 'segment_unreadable', error: `Could not read the segment's contacts (HTTP ${cr.status}).` };
  return { ok: true, segment, contacts: cr.data || [] };
}

module.exports = { resolveSegment, pgArray, MAX_MEMBERS };
