/**
 * api/_lib/webese-tracker.js — write Blade's findings into a Webese state
 * tracker ("Webese <State> Outreach Tracker") exactly the way the Webese
 * Outreach platform (airostudio/websites-outreach) expects to read them.
 *
 * Blade does the job the "Webese First-Pass Fleet" did: forward geographic
 * research, business-level data only. The Outreach platform's operating model
 * (docs/OPERATING_MODEL.md there) sets who owns each column, and this file
 * follows it:
 *   - Blade writes only the research columns (State, County, Place, Business
 *     Name, Category, Website, Website Status, platform, scores, Offer Type,
 *     observation, Discovery Date).
 *   - Every new row is Queue Status = HOLD with Notes containing
 *     CONTACT_ENRICHMENT_REQUIRED_LIVE — that is the whole handoff.
 *   - Contact fields (First Name, Owner Full Name, Owner Role, Email, Phone,
 *     Contact Source URL) and the send/reply fields belong to the Outreach
 *     platform and are never written, even when Blade has found an email.
 *   - Existing rows are never edited, so a row that is READY_FOR_APPROVAL,
 *     SENT or SUPPRESSED cannot be touched; duplicates are skipped instead.
 *   - Campaign State: the research cursor (Current County, Current Place,
 *     NEXT_CURSOR, Last Run Date/Status, Latest Run Summary, Lifecycle State)
 *     — only the cells that already exist; the layout is never changed.
 *   - Run History: one appended line per batch.
 */

'use strict';

const sheets = require('./google-sheets.js');

const TABS = { prospects: 'Prospects', campaignState: 'Campaign State', runHistory: 'Run History' };
const trackerName = (state) => `Webese ${state} Outreach Tracker`;
const AGENT = 'Blade (Audema)';
const FLEET = 'Webese First-Pass Fleet';
const HANDOFF_NOTE = 'CONTACT_ENRICHMENT_REQUIRED_LIVE';

// Columns Blade may write. Anything else in the sheet is left blank on a new row.
const BLADE_COLUMNS = ['State', 'County', 'Place', 'Business Name', 'Category', 'Website', 'Website Status',
  'Website Platform/Provider', 'Platform Evidence', 'Platform Source URL', 'Website Score', 'Opportunity Score',
  'Offer Type', 'Website Observation', 'Observation Evidence/Source URL', 'Discovery Date', 'Queue Status', 'Notes'];
// Never written by Blade, whatever the lead holds.
const FORBIDDEN_COLUMNS = ['First Name', 'Owner Full Name', 'Owner Role', 'Email', 'Phone', 'Contact Source URL',
  'Enrichment Attempts', 'Apollo Status', 'Sent Date', 'Resend Status', 'Resend ID', 'Reply Status', 'Unsubscribed', 'Suppression Status'];

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const PLATFORM_LABELS = { wix: 'Wix', squarespace: 'Squarespace', godaddy: 'GoDaddy' };

/** The registrable part of a website, for spotting the same business twice. */
function siteKey(url) {
  try {
    const h = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.toLowerCase().replace(/^www\./, '');
    const parts = h.split('.');
    const two = /^(co|com|org|net|gov|ac)$/.test(parts[parts.length - 2] || '') && parts[parts.length - 1].length === 2;
    return parts.slice(two ? -3 : -2).join('.');
  } catch { return ''; }
}
const nameKey = (name, place) => `${norm(name)}|${norm(place)}`;

/**
 * A Blade lead as tracker values (keyed by column name). Scores are Blade's
 * own judgement from what it checked — not a measurement:
 *   Website Score (1-5, the current site): 1 none, 2 outdated, 3 template builder.
 *   Opportunity Score (0-100): no website 90, outdated 72, template 70, then
 *   +5 for an established business (10+ Google reviews), -10 for one with no
 *   reviews at all.
 */
function rowValues(lead, where, today) {
  const noSite = lead.siteStatus === 'no_website';
  const platform = lead.sitePlatform ? (PLATFORM_LABELS[lead.sitePlatform] || lead.sitePlatform) : '';
  let opp = noSite ? 90 : lead.sitePlatform ? 70 : 72;
  if ((lead.reviewCount || 0) >= 10) opp += 5;
  if (!lead.reviewCount) opp -= 10;
  const evidence = (lead.siteReasons || []).find(r => /wix|squarespace|godaddy|generator|platform|powered/i.test(r)) || '';
  return {
    'State': where.state, 'County': where.county || '', 'Place': where.place,
    'Business Name': lead.name, 'Category': where.category,
    'Website': lead.website || '',
    'Website Status': noSite ? 'NO_WEBSITE' : 'LIVE',
    'Website Platform/Provider': platform,
    'Platform Evidence': platform ? evidence : '',
    'Platform Source URL': platform ? (lead.website || '') : '',
    'Website Score': String(noSite ? 1 : lead.sitePlatform ? 3 : 2),
    'Opportunity Score': String(Math.max(0, Math.min(100, opp))),
    'Offer Type': lead.sitePlatform ? 'SWITCH_AND_SAVE' : 'BUILD_REBUILD',
    'Website Observation': lead.note || (noSite ? 'No website found' : (lead.siteReasons || []).slice(0, 2).join('; ')),
    'Observation Evidence/Source URL': lead.website || lead.mapsUrl || '',
    'Discovery Date': today,
    'Queue Status': 'HOLD',
    'Notes': HANDOFF_NOTE,
  };
}

/** Values in the sheet's own column order. Columns Blade does not own stay blank. */
function toSheetRow(headers, values) {
  const byNorm = new Map(Object.entries(values).map(([k, v]) => [norm(k), v]));
  const forbidden = new Set(FORBIDDEN_COLUMNS.map(norm));
  const allowed = new Set(BLADE_COLUMNS.map(norm));
  return headers.map(h => {
    const k = norm(h);
    if (!k || forbidden.has(k) || !allowed.has(k)) return '';
    return byNorm.has(k) ? String(byNorm.get(k)) : '';
  });
}

function parseTable(values) {
  const headerIdx = (values || []).findIndex(r => r && r.some(c => String(c || '').trim()));
  if (headerIdx < 0) return { headers: [], rows: [] };
  const headers = values[headerIdx].map(h => String(h || '').trim());
  const rows = values.slice(headerIdx + 1).filter(r => r && r.some(c => String(c || '').trim())).map(r => {
    const o = {}; headers.forEach((h, i) => { if (h) o[h] = String(r[i] == null ? '' : r[i]).trim(); }); return o;
  });
  return { headers, rows };
}
const pick = (row, name) => { const k = Object.keys(row).find(x => norm(x) === norm(name)); return k ? row[k] : ''; };

/** Businesses already in the tracker, by name+place and by website. */
function existingKeys(prospectRows) {
  const names = new Set(), sites = new Set();
  for (const r of prospectRows) {
    const n = pick(r, 'Business Name');
    if (n) names.add(nameKey(n, pick(r, 'Place')));
    const s = siteKey(pick(r, 'Website'));
    if (s) sites.add(s);
  }
  return { names, sites };
}

/**
 * Campaign State's cells, in whichever layout the tracker uses (field names
 * down column A with values in B, or a header row with values below).
 * @returns {{ fields: object, cells: object }}
 */
function parseCampaignState(values) {
  const fields = {}, cells = {};
  if (!values || !values.length) return { fields, cells };
  // The same test the Outreach platform uses (src/lib/sheets/parse.ts).
  if (values.some(r => norm(r && r[0]) === 'lifecycle state')) {
    values.forEach((r, i) => { const k = String((r && r[0]) || '').trim(); if (k) { fields[k] = String(r[1] == null ? '' : r[1]).trim(); cells[k] = `B${i + 1}`; } });
    return { fields, cells };
  }
  const hi = values.findIndex(r => r && r.some(c => norm(c) === 'lifecycle state'));
  if (hi >= 0) values[hi].forEach((h, c) => { const k = String(h || '').trim(); if (k) { fields[k] = String((values[hi + 1] || [])[c] ?? '').trim(); cells[k] = `${sheets.colLetter(c)}${hi + 2}`; } });
  return { fields, cells };
}

/** The Campaign State writes for a cursor move — only cells that exist. */
function cursorWrites(cs, { county, place, status, summary, lifecycle, today }) {
  const want = {
    'Current County': county || '', 'Current Place': place || '', 'NEXT_CURSOR': `${county || ''}|${place || ''}`,
    'Last Run Date': today, 'Last Run Status': status, 'Latest Run Summary': summary,
  };
  if (lifecycle) want['Lifecycle State'] = lifecycle;
  const out = [];
  for (const [field, value] of Object.entries(want)) {
    const key = Object.keys(cs.cells).find(k => norm(k) === norm(field));
    if (key) out.push({ tab: TABS.campaignState, addr: cs.cells[key], value: String(value) });
  }
  return out;
}

/** Was the ChatGPT First-Pass Fleet working this state recently? */
function fleetActivity(historyRows, now = Date.now(), withinDays = 3) {
  const recent = historyRows.filter(r => norm(pick(r, 'Agent')) === norm(FLEET)).map(r => Date.parse(pick(r, 'Timestamp').replace(' ', 'T'))).filter(Number.isFinite);
  const last = recent.length ? Math.max(...recent) : null;
  return { last: last ? new Date(last).toISOString() : null, recent: !!last && now - last < withinDays * 86400000 };
}

/* ── I/O ──────────────────────────────────────────────────────────────── */

/** Find the state's tracker and read what Blade needs from it. */
async function openTracker(state, deps = {}) {
  const s = deps.sheets || sheets;
  const found = await s.findSpreadsheetsByName(trackerName(state));
  if (!found.length) {
    const e = new Error(`No "${trackerName(state)}" sheet is shared with ${s.serviceAccountEmail() || 'the service account'}. Create it (with Prospects, Campaign State and Run History tabs) or share it as an Editor.`);
    e.code = 'no_tracker'; throw e;
  }
  if (found.length > 1) { const e = new Error(`More than one "${trackerName(state)}" sheet is visible; keep one so Blade and the Outreach platform use the same one.`); e.code = 'duplicate_tracker'; throw e; }
  const ref = found[0];
  const tabs = await s.readTabs(ref.fileId, [TABS.prospects, TABS.campaignState, TABS.runHistory]);
  const p = parseTable(tabs[TABS.prospects]);
  if (!p.headers.some(h => norm(h) === 'business name')) { const e = new Error(`The Prospects tab in "${ref.name}" has no "Business Name" header row.`); e.code = 'bad_tracker'; throw e; }
  return { ref, prospectHeaders: p.headers, prospects: p.rows, campaign: parseCampaignState(tabs[TABS.campaignState]), history: parseTable(tabs[TABS.runHistory]) };
}

/**
 * Add a batch of qualified leads and record the run.
 * @param {object} t   from openTracker
 * @param {Array<{lead, where}>} items
 * @param {{summary, county, place, lifecycle?, stats}} run
 * @returns {Promise<{written:number, duplicates:number}>}
 */
async function writeBatch(t, items, run, deps = {}) {
  const s = deps.sheets || sheets;
  const today = (deps.now ? new Date(deps.now) : new Date()).toISOString().slice(0, 10);
  const keys = existingKeys(t.prospects);
  const rows = []; let duplicates = 0;
  for (const { lead, where } of items) {
    const nk = nameKey(lead.name, where.place), sk = siteKey(lead.website || '');
    if (keys.names.has(nk) || (sk && keys.sites.has(sk))) { duplicates++; continue; }
    keys.names.add(nk); if (sk) keys.sites.add(sk);
    const values = rowValues(lead, where, today);
    rows.push(toSheetRow(t.prospectHeaders, values));
    t.prospects.push(values);
  }
  if (rows.length) await s.appendRows(t.ref.fileId, TABS.prospects, rows);

  const writes = cursorWrites(t.campaign, { county: run.county, place: run.place, status: 'OK', summary: run.summary, lifecycle: run.lifecycle, today });
  if (writes.length) await s.writeCellsVerified(t.ref.fileId, writes);

  if (t.history.headers.length) {
    const st = run.stats || {};
    const hv = { 'Timestamp': new Date(deps.now || Date.now()).toISOString().slice(0, 16).replace('T', ' '), 'Agent': AGENT,
      'Start Cursor': run.startCursor || '', 'End Cursor': `${run.county || ''}|${run.place || ''}`, 'Area Covered': run.area || '',
      'Discovered': String(st.discovered || 0), 'Audited': String(st.audited || 0), 'Rejected': String(st.rejected || 0),
      'Qualified': String(st.qualified || 0), 'Build/Rebuild': String(items.filter(i => !i.lead.sitePlatform).length),
      'Switch & Save': String(items.filter(i => i.lead.sitePlatform).length), 'Notes': `${rows.length} added, ${duplicates} already in the tracker` };
    await s.appendRows(t.ref.fileId, TABS.runHistory, [t.history.headers.map(h => { const k = Object.keys(hv).find(x => norm(x) === norm(h)); return k ? hv[k] : ''; })]);
  }
  // Keep the in-memory copy in step so the next batch in this run sees the new cursor.
  for (const w of writes) { const k = Object.keys(t.campaign.cells).find(x => t.campaign.cells[x] === w.addr); if (k) t.campaign.fields[k] = w.value; }
  return { written: rows.length, duplicates };
}

module.exports = {
  trackerName, openTracker, writeBatch, rowValues, toSheetRow, existingKeys, parseCampaignState, cursorWrites, fleetActivity, parseTable, siteKey,
  BLADE_COLUMNS, FORBIDDEN_COLUMNS, TABS, AGENT, FLEET, HANDOFF_NOTE,
};
