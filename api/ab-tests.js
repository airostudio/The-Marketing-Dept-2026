/**
 * api/ab-tests.js — subject-line and content split tests.
 *
 * POST { action: 'create',  campaignId, name, dimension?, goal?, variants: [{label, subject?, html?, fromName?, splitPct?}] }
 * POST { action: 'list' }
 * POST { action: 'results', testId }
 * POST { action: 'assign',  testId, recipients: [{email, contactId?}] }
 * POST { action: 'recordSends', testId, sends: [{email, emailId}] }
 * POST { action: 'decide',  testId, variantId }
 * Header: Authorization: Bearer <the caller's own Supabase access token>
 *
 * ── What makes a result trustworthy here ─────────────────────────────────
 *
 *  - The goal is declared when the test is created, before anything is sent.
 *    A test read afterwards against whichever metric happened to favour a
 *    variant is not a test.
 *  - Assignment is a hash of the recipient's address, so a retried batch
 *    re-derives the assignment it already made rather than reshuffling people
 *    between arms and attributing their opens to mail they never received.
 *  - The comparison reports a leader, never a "winner": it is a difference
 *    between two rates, not a significance test, and at typical list sizes a
 *    handful of opens can reverse it.
 *
 * Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

'use strict';

const { sbRest } = require('./_lib/supabase-rest.js');
const { withFailureReporting } = require('./_lib/report-failure.js');
const { assignVariant, summariseResults } = require('./_lib/ab-split.js');

const DIMENSIONS = ['subject', 'content', 'from_name', 'send_time'];
const GOALS = ['open', 'click'];

async function getCallerFromToken(supabaseUrl, serviceKey, accessToken) {
  const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return null;
  return res.json();
}

function tableError(res) {
  if (res.status === 404) {
    return { code: 'not_installed',
             error: 'Split testing is not installed. Run supabase-email-engine.sql in the Supabase SQL editor.' };
  }
  return { code: 'db_error', error: `Database error (HTTP ${res.status}).` };
}

module.exports = withFailureReporting('api/ab-tests', async function handler(req, res) {
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

  const sb = (m, p, b) => sbRest(supabaseUrl, serviceKey, m, p, b);
  const body = req.body || {};

  /** Load a test the caller owns, or null. Ownership re-read from the DB. */
  async function ownedTest(testId) {
    if (!testId) return { http: 400, err: { error: 'testId is required.' } };
    const r = await sb('GET', `/email_ab_tests?id=eq.${encodeURIComponent(testId)}&limit=1`);
    if (!r.ok) return { http: r.status === 404 ? 503 : 500, err: tableError(r) };
    const t = r.data && r.data[0];
    if (!t || t.user_id !== caller.id) return { http: 404, err: { error: 'Test not found.' } };
    return { test: t };
  }

  try {
    /* ── create ────────────────────────────────────────────────────────── */
    if (body.action === 'create') {
      const name = String(body.name || '').trim();
      const campaignId = String(body.campaignId || '').trim();
      if (!name) return res.status(400).json({ error: 'A test name is required.' });
      if (!campaignId) return res.status(400).json({ error: 'campaignId is required.' });

      const variants = Array.isArray(body.variants) ? body.variants : [];
      if (variants.length < 2) {
        return res.status(400).json({ error: 'A split test needs at least two variants.' });
      }
      if (variants.length > 5) {
        return res.status(400).json({ error: 'At most five variants — beyond that each arm is too small to read.' });
      }

      const dimension = DIMENSIONS.includes(body.dimension) ? body.dimension : 'subject';
      const goal = GOALS.includes(body.goal) ? body.goal : 'open';

      // Splits must be usable before anything is created, not discovered to be
      // broken halfway through inserting variants.
      const totalSplit = variants.reduce((s, v) => s + (Number(v.splitPct) || 0), 0);
      if (totalSplit > 100) {
        return res.status(400).json({ error: `Variant splits total ${totalSplit}%, which is over 100%.` });
      }
      if (dimension === 'subject' && variants.some(v => !String(v.subject || '').trim())) {
        return res.status(400).json({ error: 'A subject-line test needs a subject on every variant.' });
      }

      const created = await sb('POST', '/email_ab_tests', {
        user_id: caller.id, campaign_id: campaignId, name, dimension, goal,
      });
      if (!created.ok) return res.status(created.status === 404 ? 503 : 500).json(tableError(created));
      const test = created.data && created.data[0];
      if (!test) return res.status(500).json({ error: 'The test was not created.' });

      const evenSplit = Math.floor(100 / variants.length);
      const rows = variants.map((v, i) => ({
        test_id: test.id,
        label: String(v.label || String.fromCharCode(65 + i)).slice(0, 8),
        subject: v.subject || null,
        html: v.html || null,
        from_name: v.fromName || null,
        // An unspecified split is an even share, with the remainder going to
        // the first arm so the total is exactly 100 rather than 99.
        split_pct: Number(v.splitPct) > 0 ? Number(v.splitPct)
                 : (i === 0 ? evenSplit + (100 - evenSplit * variants.length) : evenSplit),
      }));

      const ins = await sb('POST', '/email_ab_variants', rows);
      if (!ins.ok) {
        await sb('DELETE', `/email_ab_tests?id=eq.${test.id}`);  // don't leave a test with no arms
        return res.status(500).json({ error: 'The variants could not be saved.' });
      }

      return res.json({ ok: true, test: { id: test.id, name, campaignId, dimension, goal },
                        variants: ins.data || [] });
    }

    /* ── list ──────────────────────────────────────────────────────────── */
    if (body.action === 'list') {
      const r = await sb('GET',
        `/email_ab_tests?user_id=eq.${caller.id}&order=created_at.desc&limit=200`);
      if (!r.ok) return res.status(r.status === 404 ? 503 : 500).json(tableError(r));
      return res.json({ ok: true, tests: (r.data || []).map(t => ({
        id: t.id, name: t.name, campaignId: t.campaign_id, dimension: t.dimension,
        goal: t.goal, status: t.status, createdAt: t.created_at,
      })) });
    }

    /* ── assign (called by the send path, per batch) ───────────────────── */
    if (body.action === 'assign') {
      const { test, http, err } = await ownedTest(body.testId);
      if (err) return res.status(http).json(err);

      const recipients = Array.isArray(body.recipients) ? body.recipients : [];
      if (!recipients.length) return res.status(400).json({ error: 'recipients is required.' });

      const vr = await sb('GET', `/email_ab_variants?test_id=eq.${test.id}`);
      if (!vr.ok) return res.status(500).json(tableError(vr));
      const variants = vr.data || [];
      if (variants.length < 2) return res.status(409).json({ error: 'This test has fewer than two variants.' });

      const assignments = recipients.map(r => {
        const v = assignVariant(variants, test.id, r.email);
        return {
          test_id: test.id, variant_id: v.id,
          contact_id: r.contactId || null, email: r.email,
        };
      });

      // Upsert on (test_id, email): a re-run of the same batch must reuse the
      // assignment it already made, not create a second one.
      const ins = await sbRest(supabaseUrl, serviceKey, 'POST',
        '/email_ab_assignments?on_conflict=test_id,email', assignments);
      if (!ins.ok && ins.status !== 409) {
        return res.status(500).json({ error: `Could not record assignments (HTTP ${ins.status}).` });
      }

      const byId = {};
      variants.forEach(v => { byId[v.id] = v; });
      return res.json({ ok: true, assignments: assignments.map(a => ({
        email: a.email,
        variantId: a.variant_id,
        label: byId[a.variant_id].label,
        subject: byId[a.variant_id].subject,
        html: byId[a.variant_id].html,
        fromName: byId[a.variant_id].from_name,
      })) });
    }

    /* ── recordSends: attach Resend's ids so events join back ──────────── */
    if (body.action === 'recordSends') {
      const { test, http, err } = await ownedTest(body.testId);
      if (err) return res.status(http).json(err);

      const sends = Array.isArray(body.sends) ? body.sends : [];
      let updated = 0;
      for (const s of sends) {
        if (!s || !s.email || !s.emailId) continue;
        const u = await sb('PATCH',
          `/email_ab_assignments?test_id=eq.${test.id}&email=eq.${encodeURIComponent(s.email)}`,
          { email_id: s.emailId });
        if (u.ok) updated++;
      }
      // Without this the assignments exist but no event can be joined to them,
      // so every variant would report zero engagement forever.
      return res.json({ ok: true, updated, of: sends.length });
    }

    /* ── results ───────────────────────────────────────────────────────── */
    if (body.action === 'results') {
      const { test, http, err } = await ownedTest(body.testId);
      if (err) return res.status(http).json(err);

      const r = await sb('POST', '/rpc/ab_test_results', { tid: test.id, uid: caller.id });
      if (!r.ok) return res.status(r.status === 404 ? 503 : 500).json(tableError(r));

      const summary = summariseResults(r.data || [], test.goal);
      return res.json({
        ok: true,
        test: { id: test.id, name: test.name, campaignId: test.campaign_id,
                dimension: test.dimension, goal: test.goal, status: test.status,
                winnerVariantId: test.winner_variant_id },
        ...summary,
      });
    }

    /* ── decide ────────────────────────────────────────────────────────── */
    if (body.action === 'decide') {
      const { test, http, err } = await ownedTest(body.testId);
      if (err) return res.status(http).json(err);
      if (!body.variantId) return res.status(400).json({ error: 'variantId is required.' });

      const vr = await sb('GET',
        `/email_ab_variants?id=eq.${encodeURIComponent(body.variantId)}&test_id=eq.${test.id}&limit=1`);
      if (!vr.ok || !vr.data || !vr.data[0]) {
        return res.status(404).json({ error: 'That variant does not belong to this test.' });
      }

      // The person decides, not the endpoint. A raw rate difference is not
      // significance, so nothing here auto-picks a winner.
      const up = await sb('PATCH', `/email_ab_tests?id=eq.${test.id}`, {
        status: 'decided', winner_variant_id: body.variantId, decided_at: new Date().toISOString(),
      });
      if (!up.ok) return res.status(500).json({ error: 'Could not record the decision.' });
      return res.json({ ok: true });
    }

    return res.status(400).json({ error: 'Unknown action.' });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Unexpected error.' });
  }
});
