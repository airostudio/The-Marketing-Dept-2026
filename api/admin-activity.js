/**
 * Read the administrative audit trail.
 *
 * GET /api/admin-activity?limit=100&action=user_deleted&admin=<uuid>&target=<uuid>
 *
 * Admin-only, like everything else that reads across accounts. The rows are
 * written by api/_lib/audit-log.js on the service-role key; nothing — not
 * even an administrator — can write or amend them through a client, because
 * admin_activity_log carries no INSERT, UPDATE or DELETE policy and RLS
 * denies what it has no policy for.
 *
 * Read-only by design. There is no endpoint to delete an entry, and there
 * should not be: a log an administrator can prune is not evidence of
 * anything.
 */

'use strict';

const { requireAdmin } = require('./_lib/require-user.js');
const { rateLimited } = require('./_lib/rate-limit.js');
const { sbRest } = require('./_lib/supabase-rest.js');
const { isUuid } = require('./_lib/supabase-rest.js');
const { withFailureReporting } = require('./_lib/report-failure.js');

const MAX_LIMIT = 500;

module.exports = withFailureReporting('api/admin-activity', async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const auth = await requireAdmin(req, res);
  if (!auth) return;

  if (rateLimited(req, res, { name: 'admin-activity', max: 60, windowMs: 60_000, auth })) return;

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: 'Supabase is not configured.' });
  }

  const q = req.query || {};
  const limit = Math.min(parseInt(q.limit, 10) || 100, MAX_LIMIT);

  // Every filter is validated before it reaches the query string. An id is a
  // uuid or it is not sent; an action is drawn from a conservative character
  // set. PostgREST filters are composed in a URL, so an unvalidated value
  // here is a value that can add parameters to a request nobody meant to make.
  const filters = [];
  if (q.admin && isUuid(String(q.admin))) filters.push(`admin_id=eq.${q.admin}`);
  if (q.target && isUuid(String(q.target))) filters.push(`target_user_id=eq.${q.target}`);
  if (q.action && /^[a-z0-9_]{1,120}$/.test(String(q.action))) filters.push(`action=eq.${q.action}`);

  const path = `/admin_activity_log?select=*&order=created_at.desc&limit=${limit}` +
               (filters.length ? '&' + filters.join('&') : '');

  const r = await sbRest(supabaseUrl, serviceKey, 'GET', path);
  if (!r.ok) {
    return res.status(502).json({
      error: 'Could not read the activity log.',
      detail: typeof r.data === 'object' ? (r.data && r.data.message) : String(r.data).slice(0, 200),
    });
  }

  return res.status(200).json({
    entries: Array.isArray(r.data) ? r.data : [],
    limit,
    // Say when the answer is a page rather than the whole story, so nobody
    // reads "100 entries" as "100 entries exist".
    truncated: Array.isArray(r.data) && r.data.length === limit,
  });
});
