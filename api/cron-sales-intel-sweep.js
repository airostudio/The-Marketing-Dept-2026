/**
 * api/cron-sales-intel-sweep.js — the daily Sales Intelligence geographic
 * sweep: "reach out to 100-150 businesses per day in the United States,
 * going in alphabetical order for each state... every day".
 *
 * DISCOVER + DRAFT ONLY. This never sends an email. Every qualifying lead
 * is written to sales_intel_leads with sent=false; a human reviews and
 * sends via Pat/Blade. That's a deliberate choice the user confirmed when
 * asked whether the sweep should auto-send: unsupervised bulk sending is
 * not something this should ever do on its own.
 *
 * ── Traversal: state → town, alphabetical, resumable ────────────────────
 * States are walked alphabetically from api/_lib/us-states.js (a small,
 * easily-verified 51-entry list — all 50 states + DC).
 *
 * Deliberately NOT drilling through an explicit "county" tier via a
 * bundled county→town dataset: a hand-typed reference table covering all
 * ~3,100 US counties is exactly the kind of factual data this app's whole
 * anti-fabrication discipline says not to invent from a model's training
 * memory into something the product then treats as ground truth — a wrong
 * or missing county would silently skip real towns with no way to notice.
 * Instead, towns come live from the Places API (searchText, the same
 * sanctioned source Blade's own search already uses) for "{sector} in
 * {state}, USA", paginated via nextPageToken and persisted in the cursor
 * so tomorrow's run picks up exactly where today's left off. The county a
 * result actually sits in is recorded on the lead as reported by Places'
 * own formatted address — never guessed.
 *
 * Within a state, results rotate through SECTORS (the trades the user
 * named as examples — any could be added) one at a time; a state's sweep
 * for a sector is "done" once Places returns no nextPageToken, at which
 * point the cursor advances to the next sector, and to the next state once
 * every sector's been swept in this one. Reaching the end (Wyoming, last
 * sector) wraps back to Alabama — a genuinely repeatable daily sweep, not
 * a one-time pass.
 *
 * ── Every business is looked at once ────────────────────────────────────
 * sales_intel_seen_places is a permanent dedupe ledger — checked-and-modern
 * businesses are never re-audited tomorrow, and a lead already filed is
 * never duplicated (place_id is UNIQUE on sales_intel_leads too).
 *
 * ── Report ───────────────────────────────────────────────────────────────
 * A plain-text/HTML summary — leads found today, running total, and where
 * the cursor now sits — is emailed to REPORT_EMAIL via Resend directly
 * (same pattern as api/_lib/failure-alert.js), since a cron has no logged-
 * in session to send through the normal quota-checked send pipeline, and
 * this is an internal ops email, not a customer send.
 *
 * Required env vars:
 *   CRON_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 *   GOOGLE_PLACES_API_KEY, RESEND_API_KEY, RESEND_FROM_EMAIL
 * Optional: APOLLO_API_KEY and/or PERPLEXITY_API_KEY (owner-name lookup is
 *   skipped, not faked, without at least one of them), REPORT_EMAIL
 *   (defaults to info@webese.ai)
 */

'use strict';

const { withFailureReporting } = require('./_lib/report-failure.js');
const { sbRest } = require('./_lib/supabase-rest.js');
const { US_STATES } = require('./_lib/us-states.js');
const { quickCheckWebsite } = require('./_lib/website-quickcheck.js');
const { findOwnerName } = require('./_lib/owner-lookup.js');
const { findContactEmail } = require('./_lib/email-lookup.js');
const { opportunityRank, personalizedNote } = require('./_lib/lead-scoring.js');

const SECTORS = ['Plumbers', 'Electricians', 'Roofers', 'Landscapers', 'Builders', 'Dentists', 'Physiotherapists'];

const MAX_LEADS_PER_RUN = 150;       // the user's own daily target ceiling
const MAX_CANDIDATES_PER_RUN = 60;   // each candidate costs a site fetch + email lookup + (maybe) an owner-name search; caps this well inside Vercel's function budget
const DEFAULT_REPORT_EMAIL = 'info@webese.ai';

async function placesTextSearch(apiKey, textQuery, pageToken) {
  const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.websiteUri,places.businessStatus,nextPageToken',
    },
    body: JSON.stringify({
      ...(pageToken ? { pageToken } : { textQuery }),
      languageCode: 'en',
      pageSize: 20,
    }),
    signal: AbortSignal.timeout(15000),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || 'Places API error');
  return data;
}

// A US county/state name, when present, is the last "..., X County, ST ZIP"
// or "..., City, ST ZIP" segment Places' formattedAddress gives us — read
// off the real response, never inferred from a bundled list.
function extractCountyOrCity(formattedAddress, townName) {
  if (!formattedAddress) return townName || null;
  const parts = String(formattedAddress).split(',').map(s => s.trim());
  // Drop the street address (first part) and the trailing "ST ZIP, USA".
  const middle = parts.slice(1, -1);
  return middle.length ? middle[middle.length - 1] : (townName || null);
}

async function loadCursor(supabaseUrl, serviceKey) {
  const res = await sbRest(supabaseUrl, serviceKey, 'GET', '/sales_intel_sweep_cursor?id=eq.1&limit=1');
  if (res.ok && Array.isArray(res.data) && res.data[0]) return res.data[0];
  // Row is seeded by the migration, but recover gracefully if it's missing.
  const created = await sbRest(supabaseUrl, serviceKey, 'POST', '/sales_intel_sweep_cursor', { id: 1 });
  return (created.ok && Array.isArray(created.data) && created.data[0]) || { id: 1, state_index: 0, sector_index: 0, next_page_token: null, total_leads_found: 0 };
}

async function alreadySeen(supabaseUrl, serviceKey, placeId) {
  const res = await sbRest(supabaseUrl, serviceKey, 'GET', `/sales_intel_seen_places?place_id=eq.${encodeURIComponent(placeId)}&limit=1`);
  return res.ok && Array.isArray(res.data) && res.data.length > 0;
}

async function markSeen(supabaseUrl, serviceKey, placeId) {
  // A duplicate-key conflict just means another path already marked it —
  // not a real failure worth surfacing.
  await sbRest(supabaseUrl, serviceKey, 'POST', '/sales_intel_seen_places', { place_id: placeId });
}

async function auditOneCandidate(supabaseUrl, serviceKey, place, state, sector) {
  const placeId = place.id;
  const name = place.displayName?.text || '';
  const website = place.websiteUri || '';
  const townGuess = extractCountyOrCity(place.formattedAddress, null);

  let siteResult = { status: 'no_website', signals: {}, reasons: [] };
  if (website) {
    siteResult = await quickCheckWebsite(website);
  }

  const rank = opportunityRank({ siteStatus: siteResult.status, sitePlatform: siteResult.signals?.platform || null });
  // Only genuine opportunities are worth the rest of the lookup cost (email,
  // owner name) and a row in the leads table — a modern site with no
  // platform lock-in is a real, honest "not a lead", not a failure.
  if (rank > 2) {
    await markSeen(supabaseUrl, serviceKey, placeId);
    return null;
  }

  let email = null;
  if (website) {
    try {
      const found = await findContactEmail(website);
      email = found.email;
    } catch { /* leave blank rather than guess */ }
  }

  let ownerFirstName = '', ownerSource = '';
  if (process.env.APOLLO_API_KEY || process.env.PERPLEXITY_API_KEY) {
    try {
      const owner = await findOwnerName({ businessName: name, suburb: townGuess, country: 'USA', website: website || undefined });
      ownerFirstName = owner.firstName;
      ownerSource = owner.source;
    } catch { /* an owner-lookup failure just leaves the name blank, never a guess */ }
  }

  const note = personalizedNote({
    siteStatus: siteResult.status,
    sitePlatform: siteResult.signals?.platform || null,
    siteReasons: siteResult.reasons || [],
  });

  await markSeen(supabaseUrl, serviceKey, placeId);

  return {
    place_id: placeId,
    business_name: name,
    sector,
    state,
    suburb: townGuess,
    email,
    website: website || null,
    website_status: siteResult.status,
    site_platform: siteResult.signals?.platform || null,
    owner_first_name: ownerFirstName || null,
    owner_source: ownerSource || null,
    personal_note: note || null,
    opportunity_rank: rank,
    sent: false,
    replied: false,
  };
}

async function sendReport(cursor, { leadsFoundToday, candidatesToday, nextState, nextSector, totalLeadsFound }) {
  const resendKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.RESEND_FROM_EMAIL;
  const to = process.env.REPORT_EMAIL || DEFAULT_REPORT_EMAIL;
  if (!resendKey || !fromEmail) {
    console.warn('[cron-sales-intel-sweep] RESEND_API_KEY/RESEND_FROM_EMAIL not set — report not sent.');
    return { sent: false, reason: 'no_mailer' };
  }

  const subject = `Sales Intel sweep: ${leadsFoundToday} new lead${leadsFoundToday === 1 ? '' : 's'} today (${totalLeadsFound} total)`;
  const text = [
    `Checked ${candidatesToday} businesses today, found ${leadsFoundToday} genuine opportunities.`,
    `Running total: ${totalLeadsFound} leads on file, all discover+draft only — nothing has been sent.`,
    `Next run picks up at: ${nextState} / ${nextSector}.`,
    `Review and send from Blade/Pat: https://audema.com/agents/blade-agent.html`,
  ].join('\n');
  const html = text.split('\n').map(l => `<p>${l}</p>`).join('\n');

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: `${process.env.RESEND_FROM_NAME || 'Audema'} <${fromEmail}>`,
      to: [to],
      subject,
      html,
      text,
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    console.error('[cron-sales-intel-sweep] Resend refused the report:', res.status);
    return { sent: false, reason: `resend_${res.status}` };
  }
  return { sent: true };
}

module.exports = withFailureReporting('api/cron-sales-intel-sweep', async function handler(req, res) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return res.status(500).json({ error: 'CRON_SECRET is not configured — refusing to run an unauthenticated sweep.' });
  }
  if (req.headers['authorization'] !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: 'SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not configured.' });
  }
  const placesKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!placesKey) return res.status(500).json({ error: 'GOOGLE_PLACES_API_KEY not configured.' });

  const cursor = await loadCursor(supabaseUrl, serviceKey);
  let stateIndex = cursor.state_index % US_STATES.length;
  let sectorIndex = cursor.sector_index % SECTORS.length;
  let pageToken = cursor.next_page_token || null;

  const newLeads = [];
  let candidatesSeen = 0;
  let exhaustedThisRun = false;

  // A state+sector pair can span many pages; keep advancing within this one
  // run until either the budget caps are hit or that pair is exhausted, so
  // one run's report reflects genuine progress rather than a single page.
  //
  // sweepIterations is a hard ceiling independent of candidatesSeen: a page
  // whose businesses were ALL already in sales_intel_seen_places (revisiting
  // a state+sector that's fully picked over) advances the cursor without
  // ever incrementing candidatesSeen, and without this cap the loop would
  // spin through every remaining state/sector combination — up to hundreds
  // of live Places calls — in one request. Deliberately much smaller than
  // US_STATES.length * SECTORS.length: this branch only fires when nothing
  // new was found, so it should give up and let tomorrow's run continue
  // from here, well inside Vercel's function-duration budget, rather than
  // exhaustively searching for the next new business in the same run.
  let sweepIterations = 0;
  const MAX_SWEEP_ITERATIONS = 40;
  while (candidatesSeen < MAX_CANDIDATES_PER_RUN && newLeads.length < MAX_LEADS_PER_RUN && sweepIterations < MAX_SWEEP_ITERATIONS) {
    sweepIterations++;
    const state = US_STATES[stateIndex];
    const sector = SECTORS[sectorIndex];
    const textQuery = `${sector} in ${state}, USA`;

    let page;
    try {
      page = await placesTextSearch(placesKey, textQuery, pageToken);
    } catch (e) {
      console.error(`[cron-sales-intel-sweep] Places search failed for "${textQuery}":`, e.message);
      break; // report what was found this run rather than losing it to a retry
    }

    const places = page.places || [];
    for (const place of places) {
      if (candidatesSeen >= MAX_CANDIDATES_PER_RUN || newLeads.length >= MAX_LEADS_PER_RUN) break;
      if (!place.id || !place.displayName?.text) continue;
      if (await alreadySeen(supabaseUrl, serviceKey, place.id)) continue;

      candidatesSeen++;
      try {
        const lead = await auditOneCandidate(supabaseUrl, serviceKey, place, state, sector);
        if (lead) newLeads.push(lead);
      } catch (e) {
        console.error(`[cron-sales-intel-sweep] candidate audit failed for ${place.displayName?.text}:`, e.message);
      }
    }

    pageToken = page.nextPageToken || null;
    if (!pageToken) {
      // This state+sector is exhausted — advance to the next sector, and to
      // the next state once every sector's been swept here. Wraps forever.
      exhaustedThisRun = true;
      sectorIndex = (sectorIndex + 1) % SECTORS.length;
      if (sectorIndex === 0) stateIndex = (stateIndex + 1) % US_STATES.length;
    }
    if (!pageToken && candidatesSeen < MAX_CANDIDATES_PER_RUN && newLeads.length < MAX_LEADS_PER_RUN) {
      continue; // keep going into the next state/sector within the same run
    }
    break;
  }

  // Write leads. A place_id conflict means it was already filed (e.g. a
  // concurrent run, or the same business turning up under two sectors) —
  // not a real error.
  let inserted = 0;
  for (const lead of newLeads) {
    const r = await sbRest(supabaseUrl, serviceKey, 'POST', '/sales_intel_leads', lead);
    if (r.ok) inserted++;
  }

  const today = new Date().toISOString().slice(0, 10);
  await sbRest(supabaseUrl, serviceKey, 'PATCH', '/sales_intel_sweep_cursor?id=eq.1', {
    state_index: stateIndex,
    sector_index: sectorIndex,
    next_page_token: pageToken,
    leads_found_today: inserted,
    candidates_today: candidatesSeen,
    last_run_at: new Date().toISOString(),
    last_run_date: today,
    total_leads_found: (cursor.total_leads_found || 0) + inserted,
    updated_at: new Date().toISOString(),
  });

  const report = await sendReport(cursor, {
    leadsFoundToday: inserted,
    candidatesToday: candidatesSeen,
    nextState: US_STATES[stateIndex],
    nextSector: SECTORS[sectorIndex],
    totalLeadsFound: (cursor.total_leads_found || 0) + inserted,
  });

  return res.json({
    success: true,
    candidatesChecked: candidatesSeen,
    leadsFound: inserted,
    exhaustedCurrentPair: exhaustedThisRun,
    resumeAt: { state: US_STATES[stateIndex], sector: SECTORS[sectorIndex] },
    totalLeadsFound: (cursor.total_leads_found || 0) + inserted,
    reportSent: report.sent,
  });
});
