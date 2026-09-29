/**
 * api/sales-intel-leads.js — read (and optionally export) the leads
 * api/cron-sales-intel-sweep.js has filed. Admin-only: this is a shared
 * company-wide prospecting list, not per-customer data, same reasoning as
 * api/admin-activity.js.
 *
 * GET /api/sales-intel-leads?limit=200&sent=false
 * GET /api/sales-intel-leads?format=csv&sent=false
 *   → the exact mail-merge column order Blade's own export uses:
 *     First Name,Business,Suburb,Email,Website,Website Status,Personal Note,Sent,Replied
 *
 * Read-only. There is no PATCH/DELETE here — marking a lead sent/replied is
 * Pat's job once a send actually happens (tracked in its own campaign_sends
 * records), not something this endpoint should let anyone hand-edit.
 */

'use strict';

const { requireAdmin } = require('./_lib/require-user.js');
const { rateLimited } = require('./_lib/rate-limit.js');
const { sbRest } = require('./_lib/supabase-rest.js');
const { withFailureReporting } = require('./_lib/report-failure.js');

const MAX_LIMIT = 1000;

const STATUS_LABEL = {
  no_website: 'No website',
  outdated: 'Outdated',
  unreachable: 'Unreachable',
  modern: 'Modern',
};

function csvField(value) {
  const s = String(value == null ? '' : value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

module.exports = withFailureReporting('api/sales-intel-leads', async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const auth = await requireAdmin(req, res);
  if (!auth) return;

  if (rateLimited(req, res, { name: 'sales-intel-leads', max: 30, windowMs: 60_000, auth })) return;

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return res.status(500).json({ error: 'Supabase is not configured.' });

  const q = req.query || {};
  const limit = Math.min(parseInt(q.limit, 10) || 200, MAX_LIMIT);
  const format = String(q.format || '').toLowerCase();

  const filters = [];
  if (q.sent === 'true' || q.sent === 'false') filters.push(`sent=eq.${q.sent}`);
  if (q.state && /^[A-Za-z .]{1,40}$/.test(String(q.state))) filters.push(`state=eq.${encodeURIComponent(q.state)}`);

  const path = `/sales_intel_leads?select=*&order=discovered_at.desc&limit=${limit}` +
               (filters.length ? '&' + filters.join('&') : '');

  const r = await sbRest(supabaseUrl, serviceKey, 'GET', path);
  if (!r.ok) {
    return res.status(502).json({ error: 'Could not read sales_intel_leads.', detail: r.data });
  }
  const leads = Array.isArray(r.data) ? r.data : [];

  if (format === 'csv') {
    const rows = leads.map(l => [
      l.owner_first_name || '', l.business_name, l.suburb || '', l.email || '',
      l.website || 'None',
      STATUS_LABEL[l.website_status] || l.website_status || 'Not checked',
      l.personal_note || '', l.sent ? 'Yes' : 'No', l.replied ? 'Yes' : 'No',
    ].map(csvField).join(','));
    const csv = ['First Name,Business,Suburb,Email,Website,Website Status,Personal Note,Sent,Replied']
      .concat(rows).join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="sales-intel-leads.csv"');
    return res.status(200).end(csv);
  }

  return res.status(200).json({
    leads,
    limit,
    truncated: leads.length === limit,
  });
});
