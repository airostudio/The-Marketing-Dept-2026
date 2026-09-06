/**
 * api/support-tickets.js — raise, answer and track support tickets.
 *
 * One endpoint serves both sides, because almost every action needs the same
 * question answered first: "is the caller the customer who owns this ticket,
 * or is the caller support?" Splitting it into two files would mean writing
 * that check twice and letting the two copies drift.
 *
 * Customer actions (any signed-in account):
 *   POST { action: 'create', subject, body, category?, pageUrl? }
 *   POST { action: 'list' }                    — their own tickets
 *   POST { action: 'thread', ticketId }        — their own ticket + replies
 *   POST { action: 'reply',  ticketId, body }
 *
 * Admin actions (profiles.role IN ('admin','super_admin')):
 *   POST { action: 'queue', status?, limit? }
 *   POST { action: 'thread', ticketId }        — any ticket, incl. internal notes
 *   POST { action: 'reply',  ticketId, body, internal? }
 *   POST { action: 'setStatus',   ticketId, status }
 *   POST { action: 'setPriority', ticketId, priority }
 *
 * Header: Authorization: Bearer <the caller's own Supabase access token>
 * Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * ── Two things this is careful about ─────────────────────────────────────
 *
 * 1. Internal notes are filtered server-side, not in the page. The customer
 *    thread is built by never selecting internal rows for a non-admin caller,
 *    so a note cannot leak through a UI bug or a hand-made request. Sending
 *    the whole thread and hiding part of it in CSS would put support's private
 *    notes one devtools panel away from the customer.
 *
 * 2. The endpoint holds the service-role key, which bypasses RLS entirely, so
 *    every read and write here re-establishes who the caller is from the
 *    database. Nothing about identity, ownership or role is taken from the
 *    request body.
 */

'use strict';

const { sbRest } = require('./_lib/supabase-rest.js');

const CATEGORIES = ['question', 'bug', 'billing', 'feature', 'account', 'other'];
const STATUSES   = ['open', 'pending', 'resolved', 'closed'];
const PRIORITIES = ['low', 'normal', 'high', 'urgent'];

const MAX_SUBJECT = 200;
const MAX_BODY    = 10000;

async function getCallerFromToken(supabaseUrl, serviceKey, accessToken) {
  const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return null;
  return res.json();
}

/** The caller's own profile row — role and plan both come from here. */
async function getCallerProfile(supabaseUrl, serviceKey, userId) {
  const res = await sbRest(supabaseUrl, serviceKey, 'GET',
    `/profiles?id=eq.${userId}&select=id,role,plan,email,firstname,lastname&limit=1`);
  return (res.ok && res.data && res.data[0]) || null;
}

function isAdmin(profile) {
  return !!profile && (profile.role === 'admin' || profile.role === 'super_admin');
}

/** A missing table is a different failure from a broken one; say which. */
function tableError(res) {
  if (res.status === 404) {
    return {
      code: 'not_installed',
      error: 'The support tables do not exist yet. Run supabase-support.sql in the Supabase SQL editor.',
    };
  }
  return { code: 'db_error', error: `Database error (HTTP ${res.status}).` };
}

function shapeTicket(t, people) {
  const p = (people && people[t.user_id]) || {};
  const name = [p.firstname, p.lastname].filter(Boolean).join(' ').trim();
  return {
    id: t.id,
    subject: t.subject,
    category: t.category,
    status: t.status,
    priority: t.priority,
    pageUrl: t.page_url || null,
    planAtOpen: t.plan_at_open || null,
    lastReplyAt: t.last_reply_at,
    lastReplyBy: t.last_reply_by,
    createdAt: t.created_at,
    customer: people ? { id: t.user_id, email: p.email || null, name: name || null } : undefined,
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: 'SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not configured.' });
  }

  const accessToken = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
  if (!accessToken) return res.status(401).json({ error: 'Missing Authorization header.' });

  const caller = await getCallerFromToken(supabaseUrl, serviceKey, accessToken);
  if (!caller?.id) return res.status(401).json({ error: 'Invalid or expired session.' });

  const profile = await getCallerProfile(supabaseUrl, serviceKey, caller.id);
  const admin = isAdmin(profile);

  const body = req.body || {};
  const action = body.action;

  const sb = (method, path, payload) => sbRest(supabaseUrl, serviceKey, method, path, payload);

  /** Load a ticket and decide whether this caller may touch it at all. */
  async function loadTicket(ticketId) {
    if (!ticketId || typeof ticketId !== 'string') {
      return { http: 400, err: { error: 'ticketId is required.' } };
    }
    const r = await sb('GET', `/support_tickets?id=eq.${encodeURIComponent(ticketId)}&limit=1`);
    if (!r.ok) return { http: r.status === 404 ? 503 : 500, err: tableError(r) };
    const ticket = r.data && r.data[0];
    // A ticket that exists but belongs to someone else, and a ticket that does
    // not exist, answer identically on purpose: otherwise the difference
    // between the two responses tells a stranger which ticket IDs are real.
    if (!ticket || (!admin && ticket.user_id !== caller.id)) {
      return { http: 404, err: { error: 'Ticket not found.' } };
    }
    return { ticket };
  }

  try {
    /* ── create ────────────────────────────────────────────────────────── */
    if (action === 'create') {
      const subject = String(body.subject || '').trim();
      const message = String(body.body || '').trim();
      if (!subject) return res.status(400).json({ error: 'A subject is required.' });
      if (!message) return res.status(400).json({ error: 'A message is required.' });
      if (subject.length > MAX_SUBJECT) return res.status(400).json({ error: `Subject must be ${MAX_SUBJECT} characters or fewer.` });
      if (message.length > MAX_BODY) return res.status(400).json({ error: `Message must be ${MAX_BODY} characters or fewer.` });

      const category = CATEGORIES.includes(body.category) ? body.category : 'question';
      const pageUrl = typeof body.pageUrl === 'string' ? body.pageUrl.slice(0, 500) : null;

      const created = await sb('POST', '/support_tickets', {
        user_id: caller.id,
        subject,
        category,
        page_url: pageUrl,
        // Read from the caller's profile, not from the request: the plan is
        // not the customer's to assert.
        plan_at_open: (profile && profile.plan) || null,
        last_reply_by: 'customer',
      });
      if (!created.ok) return res.status(created.status === 404 ? 503 : 500).json(tableError(created));

      const ticket = created.data && created.data[0];
      if (!ticket) return res.status(500).json({ error: 'The ticket was not created.' });

      // The opening message is the first reply, so the thread has one shape
      // throughout rather than a special first item stored on the ticket.
      const first = await sb('POST', '/support_ticket_replies', {
        ticket_id: ticket.id,
        author_id: caller.id,
        author_role: 'customer',
        body: message,
      });
      if (!first.ok) {
        // Don't leave a ticket with an empty thread behind.
        await sb('DELETE', `/support_tickets?id=eq.${ticket.id}`);
        return res.status(500).json({ error: 'The ticket could not be saved.' });
      }

      return res.json({ ok: true, ticket: shapeTicket(ticket) });
    }

    /* ── list (the caller's own tickets) ───────────────────────────────── */
    if (action === 'list') {
      const r = await sb('GET',
        `/support_tickets?user_id=eq.${caller.id}&order=last_reply_at.desc&limit=100`);
      if (!r.ok) return res.status(r.status === 404 ? 503 : 500).json(tableError(r));
      return res.json({ ok: true, tickets: (r.data || []).map(t => shapeTicket(t)) });
    }

    /* ── queue (admin) ─────────────────────────────────────────────────── */
    if (action === 'queue') {
      if (!admin) return res.status(403).json({ error: 'Admin privileges required.' });

      const limit = Math.min(Math.max(parseInt(body.limit, 10) || 100, 1), 500);
      let filter = '';
      if (body.status && body.status !== 'all') {
        if (!STATUSES.includes(body.status)) return res.status(400).json({ error: 'Unknown status.' });
        filter = `&status=eq.${body.status}`;
      }
      // Oldest activity first: the queue is ordered by who has waited longest,
      // which is the only ordering that stops tickets being quietly forgotten.
      const r = await sb('GET',
        `/support_tickets?select=*${filter}&order=last_reply_at.asc&limit=${limit}`);
      if (!r.ok) return res.status(r.status === 404 ? 503 : 500).json(tableError(r));

      const rows = r.data || [];
      const people = {};
      if (rows.length) {
        const ids = [...new Set(rows.map(t => t.user_id))].join(',');
        const pr = await sb('GET', `/profiles?id=in.(${ids})&select=id,email,firstname,lastname`);
        (pr.ok && pr.data ? pr.data : []).forEach(p => { people[p.id] = p; });
      }

      const counts = {};
      STATUSES.forEach(s => { counts[s] = 0; });
      rows.forEach(t => { if (counts[t.status] !== undefined) counts[t.status]++; });

      return res.json({
        ok: true,
        tickets: rows.map(t => shapeTicket(t, people)),
        // Counts over the rows returned, not over the whole table — said
        // plainly so nobody reads a filtered count as a total.
        countsInThisPage: counts,
        truncated: rows.length === limit,
      });
    }

    /* ── thread ────────────────────────────────────────────────────────── */
    if (action === 'thread') {
      const { ticket, http, err } = await loadTicket(body.ticketId);
      if (err) return res.status(http).json(err);

      // Internal notes are excluded from the query itself for a non-admin
      // caller, so they are never in the response to filter out later.
      const scope = admin ? '' : '&internal=eq.false';
      const r = await sb('GET',
        `/support_ticket_replies?ticket_id=eq.${ticket.id}${scope}&order=created_at.asc&limit=500`);
      if (!r.ok) return res.status(r.status === 404 ? 503 : 500).json(tableError(r));

      let people = null;
      if (admin) {
        const pr = await sb('GET', `/profiles?id=eq.${ticket.user_id}&select=id,email,firstname,lastname`);
        people = {};
        (pr.ok && pr.data ? pr.data : []).forEach(p => { people[p.id] = p; });
      }

      return res.json({
        ok: true,
        ticket: shapeTicket(ticket, people),
        replies: (r.data || []).map(x => ({
          id: x.id,
          authorRole: x.author_role,
          body: x.body,
          internal: x.internal,
          createdAt: x.created_at,
          mine: x.author_id === caller.id,
        })),
        viewerIsAdmin: admin,
      });
    }

    /* ── reply ─────────────────────────────────────────────────────────── */
    if (action === 'reply') {
      const { ticket, http, err } = await loadTicket(body.ticketId);
      if (err) return res.status(http).json(err);

      const message = String(body.body || '').trim();
      if (!message) return res.status(400).json({ error: 'A message is required.' });
      if (message.length > MAX_BODY) return res.status(400).json({ error: `Message must be ${MAX_BODY} characters or fewer.` });

      // The role is derived from who the caller actually is, never sent.
      const authorRole = admin ? 'support' : 'customer';
      const internal = admin && body.internal === true;

      if (!admin && ticket.status === 'closed') {
        return res.status(409).json({
          error: 'This ticket is closed. Please raise a new one so it reaches the queue.',
        });
      }

      const r = await sb('POST', '/support_ticket_replies', {
        ticket_id: ticket.id,
        author_id: caller.id,
        author_role: authorRole,
        body: message,
        internal,
      });
      if (!r.ok) return res.status(r.status === 404 ? 503 : 500).json(tableError(r));

      // status/last_reply_at are moved by the trg_support_reply_bump trigger,
      // not here, so they cannot be skipped by a caller that forgets to.
      return res.json({ ok: true, reply: r.data && r.data[0] ? {
        id: r.data[0].id,
        authorRole,
        body: message,
        internal,
        createdAt: r.data[0].created_at,
        mine: true,
      } : null });
    }

    /* ── setStatus / setPriority (admin) ───────────────────────────────── */
    if (action === 'setStatus' || action === 'setPriority') {
      if (!admin) return res.status(403).json({ error: 'Admin privileges required.' });
      const { ticket, http, err } = await loadTicket(body.ticketId);
      if (err) return res.status(http).json(err);

      let patch;
      if (action === 'setStatus') {
        if (!STATUSES.includes(body.status)) {
          return res.status(400).json({ error: `Status must be one of: ${STATUSES.join(', ')}.` });
        }
        patch = { status: body.status };
      } else {
        if (!PRIORITIES.includes(body.priority)) {
          return res.status(400).json({ error: `Priority must be one of: ${PRIORITIES.join(', ')}.` });
        }
        patch = { priority: body.priority };
      }

      const r = await sb('PATCH', `/support_tickets?id=eq.${ticket.id}`, patch);
      if (!r.ok) return res.status(r.status === 404 ? 503 : 500).json(tableError(r));
      return res.json({ ok: true, ticket: shapeTicket((r.data && r.data[0]) || ticket) });
    }

    return res.status(400).json({ error: 'Unknown action.' });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Unexpected error.' });
  }
};

module.exports.CATEGORIES = CATEGORIES;
module.exports.STATUSES = STATUSES;
module.exports.PRIORITIES = PRIORITIES;
