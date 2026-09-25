/**
 * api/cron-grant-watch.js — sweeps government funding sources across
 * Australia, the UK, the EU and the US and files genuinely relevant
 * opportunities into the Government Funding Room at stage "discovered".
 *
 * Same shape as api/cron-competitor-watch.js: bearer-gated by CRON_SECRET,
 * writes with the service-role key (a cron has no logged-in session), and
 * keeps itself inside Vercel's 60s function budget.
 *
 * ── dryRun ───────────────────────────────────────────────────────────────
 * GET /api/cron-grant-watch?dryRun=1 fetches every source and reports what
 * each one actually returned — counts, a sample record, or the parse failure
 * and a slice of the unrecognised payload — WITHOUT writing anything.
 *
 * That mode exists because none of these adapters could be called from the
 * environment they were written in (outbound access to every government host
 * was blocked), so their live response shapes are unverified. dryRun is how
 * you check each source for yourself in one request, rather than discovering
 * a broken adapter as a silently empty pipeline weeks later.
 *
 * Required env vars:
 *   CRON_SECRET — bearer token, same gate as the other cron jobs
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY — to file discoveries
 */

'use strict';

const { sbRest } = require('./_lib/supabase-rest.js');
const { withFailureReporting } = require('./_lib/report-failure.js');
const { SOURCES, runSource } = require('./_lib/grant-sources.js');

// Hard ceiling on how many new rows one sweep may add. A portal redesign or
// an over-broad query should not be able to dump hundreds of rows into the
// pipeline — the scored pipeline is the product, and drowning it is the
// failure mode this whole feature is supposed to avoid.
const MAX_INSERTS_PER_RUN = 40;

module.exports = withFailureReporting('api/cron-grant-watch', async function handler(req, res) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return res.status(500).json({ error: 'CRON_SECRET is not configured — refusing to run an unauthenticated grant sweep.' });
  }
  if (req.headers['authorization'] !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const dryRun = String(req.query?.dryRun || '') === '1';
  const onlySource = req.query?.source || null;

  const sources = onlySource ? SOURCES.filter(s => s.key === onlySource) : SOURCES;
  if (!sources.length) {
    return res.status(400).json({
      error: `Unknown source "${onlySource}".`,
      available: SOURCES.map(s => s.key),
    });
  }

  // Sources are independent; one being down must not delay or fail the rest.
  const results = await Promise.all(sources.map(runSource));

  // ── Dry run: report, write nothing ──────────────────────────────────────
  if (dryRun) {
    return res.json({
      dryRun: true,
      note: 'Nothing was written. This shows what each source actually returned.',
      sources: results.map(r => ({
        key: r.key, name: r.name, region: r.region, mode: r.mode,
        ok: r.ok,
        error: r.error || null,
        unrecognisedShape: r.unrecognisedShape || false,
        sample: r.sample || null,
        fetched: r.fetched,
        relevant: r.relevant,
        // One real record, so the normalisation can be eyeballed rather than trusted.
        exampleRelevant: (r.items.find(i => i.relevant) || null),
        ms: r.ms,
      })),
      checkedAt: new Date().toISOString(),
    });
  }

  // ── Real sweep ──────────────────────────────────────────────────────────
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: 'SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not configured.' });
  }

  const candidates = [];
  results.forEach(r => r.items.forEach(i => { if (i.relevant) candidates.push(i); }));

  // Dedupe against what is already tracked. Matching on the publisher's own
  // id per source means re-running the sweep is idempotent, and an
  // opportunity already moved along the pipeline is never resurrected back
  // to "discovered".
  const existingRes = await sbRest(supabaseUrl, serviceKey, 'GET',
    '/grant_opportunities?select=source_key,external_id&external_id=not.is.null&limit=5000');
  if (!existingRes.ok) {
    return res.status(502).json({ error: 'Could not read existing opportunities to dedupe against.' });
  }
  const seen = new Set((existingRes.data || []).map(r => `${r.source_key}::${r.external_id}`));

  const fresh = candidates.filter(c => !seen.has(`${c.source_key}::${c.external_id}`));
  const toInsert = fresh.slice(0, MAX_INSERTS_PER_RUN);

  let inserted = 0;
  const insertErrors = [];
  for (const c of toInsert) {
    const row = {
      name: String(c.name).slice(0, 300),
      funder: c.funder ? String(c.funder).slice(0, 200) : null,
      program: c.program ? String(c.program).slice(0, 200) : null,
      level: levelFor(c),
      region: c.region,
      stage: 'discovered',
      opens_at: c.opens_at,
      closes_at: c.closes_at,
      source_url: c.source_url || null,
      source_key: c.source_key,
      external_id: String(c.external_id).slice(0, 400),
      match_terms: c.match_terms,
      // Deliberately unscored. Discovery is not assessment — an opportunity
      // arrives with no score so it cannot be mistaken for one that has been
      // judged, and it sits at "discovered" until a human scores it.
      scorecard: {},
      notes: c.blurb ? String(c.blurb).slice(0, 1000) : null,
    };
    const insRes = await sbRest(supabaseUrl, serviceKey, 'POST', '/grant_opportunities', row);
    if (insRes.ok) inserted++;
    else insertErrors.push({ name: row.name.slice(0, 60), status: insRes.status });
  }

  return res.json({
    success: true,
    sources: results.map(r => ({
      key: r.key, region: r.region, ok: r.ok,
      error: r.error || null, unrecognisedShape: r.unrecognisedShape || false,
      fetched: r.fetched, relevant: r.relevant,
    })),
    candidates: candidates.length,
    newAfterDedupe: fresh.length,
    inserted,
    // If more were new than the cap allowed, say so — silently dropping them
    // would look identical to there being nothing more to find.
    capped: fresh.length > toInsert.length ? fresh.length - toInsert.length : 0,
    insertErrors: insertErrors.length ? insertErrors : undefined,
    failedSources: results.filter(r => !r.ok).map(r => r.key),
    checkedAt: new Date().toISOString(),
  });
});

/**
 * Map a discovery onto the funding-type vocabulary the Funding Room already
 * uses. Deliberately conservative: anything not clearly identifiable is left
 * as the region's generic type rather than guessed into a specific program
 * category a human would then have to un-guess.
 */
function levelFor(c) {
  const t = `${c.name} ${c.blurb || ''}`.toLowerCase();
  if (/r&d tax|research and development tax/.test(t)) return 'rd_tax_incentive';
  if (/emdg|export market development/.test(t)) return 'emdg';
  if (/commercialis|commercializ/.test(t)) return 'commercialisation';
  if (/tender|procurement/.test(t)) return 'tender';
  if (/universit|research partner|collaborat/.test(t)) return 'research_partnership';
  if (c.region === 'au') return 'federal';
  return 'international';
}
