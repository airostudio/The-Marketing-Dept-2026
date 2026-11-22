/**
 * api/scorecard-public.js — the public side of scorecards and waitlists: the
 * page at /s/<slug> loads its questions from here and submits answers here.
 * No login: this is what a business's visitors use.
 *
 * GET  ?slug=<slug>
 *   → a live scorecard's public definition plus a signed start token;
 *     { status: 'closed' } for a closed one; 404 for anything else (a draft is
 *     not public).
 * POST { slug, answers, email, firstName?, consent, startToken, src?, c?, website }
 *   Scores the answers on the server (api/_lib/scorecard.js), stores the
 *   response, and — only if the visitor ticked the consent box — adds or
 *   updates them as a subscribed contact of the business, tagged by scorecard
 *   and result so email flows can follow up. Returns their result (scorecard)
 *   or their place in line (waitlist).
 *
 * Abuse guards, because this is the first public form in the app:
 *   - `website` is a honeypot field people never see: a bot that fills it is
 *     answered politely and nothing is stored;
 *   - the start token proves the page was loaded at least a few seconds
 *     earlier and today;
 *   - a per-address rate limit, and at most 3 submissions per email per
 *     scorecard in 10 minutes.
 *
 * Marketing consent is never a condition of seeing a result. Without it the
 * answers are kept (they are the business's research) but no contact is
 * created or changed, and nobody is emailed.
 *
 * Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY. Optional:
 * SCORECARD_SECRET (signs start tokens; falls back to UNSUBSCRIBE_SECRET or
 * the service key).
 */

'use strict';

const { sbRest } = require('./_lib/supabase-rest.js');
const { withFailureReporting } = require('./_lib/report-failure.js');
const { rateLimited } = require('./_lib/rate-limit.js');
const sc = require('./_lib/scorecard.js');

const str = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
const RECENT_WINDOW_MS = 10 * 60 * 1000;
const MAX_RECENT_PER_EMAIL = 3;

/** The words the visitor agrees to. Kept verbatim on the response and the contact. */
function consentLabel(def) {
  if (def.consentLabel) return def.consentLabel;
  return def.kind === 'waitlist'
    ? `Email me when ${def.businessName} launches, and with occasional updates. I can unsubscribe any time.`
    : `Email me my results and helpful follow-ups from ${def.businessName}. I can unsubscribe any time.`;
}

/** Only what a visitor needs to see — never owner ids, groups or segments. */
function publicView(row) {
  const d = row.definition || {};
  return {
    slug: row.slug, kind: row.kind, title: d.title, businessName: d.businessName, privacyUrl: d.privacyUrl || null,
    intro: d.intro, consentLabel: consentLabel(d),
    questions: (d.questions || []).map(q => ({
      id: q.id, prompt: q.prompt, help: q.help || '', type: q.type, required: q.required !== false,
      ...(q.options ? { options: q.options.map(o => ({ id: o.id, label: o.label })) } : {}),   // points stay on the server
      ...(q.type === 'scale' ? { min: q.min, max: q.max, minLabel: q.minLabel, maxLabel: q.maxLabel } : {}),
    })),
  };
}

module.exports = withFailureReporting('api/scorecard-public', async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return res.status(500).json({ error: 'This page is not available right now.' });
  const sb = (m, p, b) => sbRest(supabaseUrl, serviceKey, m, p, b);

  const slug = String((req.method === 'GET' ? (req.query || {}).slug : (req.body || {}).slug) || '').toLowerCase();
  if (!sc.SLUG_RE.test(slug)) return res.status(404).json({ error: 'Not found.' });

  const load = async () => {
    const r = await sb('GET', `/scorecards?slug=eq.${slug}&select=*&limit=1`);
    return r.ok && r.data && r.data[0];
  };

  if (req.method === 'GET') {
    if (rateLimited(req, res, { name: 'scorecard-view', max: 60, windowMs: 60 * 1000 })) return;
    const row = await load();
    if (!row || row.status === 'draft') return res.status(404).json({ error: 'Not found.' });
    if (row.status === 'closed') return res.json({ status: 'closed', title: row.definition?.title || row.title, businessName: row.definition?.businessName || '' });
    return res.json({ status: 'live', scorecard: publicView(row), startToken: sc.signStart(slug) });
  }

  // ── a submission ────────────────────────────────────────────────────────
  if (rateLimited(req, res, { name: 'scorecard-submit', max: 8, windowMs: 60 * 1000 })) return;
  const body = req.body || {};
  // Honeypot: nothing is stored, and the bot is not told why.
  if (str(body.website, 200)) return res.json({ ok: true });

  const tokenProblem = sc.checkStart(slug, body.startToken);
  if (tokenProblem) return res.status(400).json({ error: tokenProblem, code: 'start_token' });

  const row = await load();
  if (!row || row.status !== 'live') return res.status(404).json({ error: 'This is no longer taking answers.' });
  const def = row.definition || {};

  const email = str(body.email, 254).toLowerCase();
  if (!sc.EMAIL_RE.test(email)) return res.status(400).json({ error: 'Please enter a valid email address.', field: 'email' });
  const firstName = str(body.firstName, 80);
  const scored = sc.scoreAnswers(def, body.answers);
  if (!scored.ok) return res.status(400).json({ error: scored.problems[0], problems: scored.problems });

  const since = new Date(Date.now() - RECENT_WINDOW_MS).toISOString();
  const recent = await sb('GET', `/scorecard_responses?scorecard_id=eq.${row.id}&email=eq.${encodeURIComponent(email)}&created_at=gte.${encodeURIComponent(since)}&select=id&limit=${MAX_RECENT_PER_EMAIL}`);
  if (recent.ok && (recent.data || []).length >= MAX_RECENT_PER_EMAIL) {
    return res.status(429).json({ error: 'You have already sent this a few times just now. Please wait a few minutes.' });
  }

  // A waitlist place is kept: joining twice does not move you or add a second person.
  let position = null;
  if (row.kind === 'waitlist') {
    const mine = await sb('GET', `/scorecard_responses?scorecard_id=eq.${row.id}&email=eq.${encodeURIComponent(email)}&position=not.is.null&select=position&order=created_at.asc&limit=1`);
    if (mine.ok && mine.data && mine.data[0]) position = mine.data[0].position;
    else {
      const last = await sb('GET', `/scorecard_responses?scorecard_id=eq.${row.id}&position=not.is.null&select=position&order=position.desc&limit=1`);
      position = ((last.ok && last.data && last.data[0] && last.data[0].position) || 0) + 1;
    }
  }

  const consented = body.consent === true;
  const label = consentLabel(def);
  const source = sc.cleanSource(body.src);
  const campaign = str(body.c, 80) || null;
  const now = new Date().toISOString();

  // ── the contact, only with consent ──────────────────────────────────────
  let contactId = null, contactNote = null;
  if (consented) {
    const tags = sc.tagsFor(slug, def, scored);
    const record = { slug, title: def.title, kind: row.kind, percent: scored.percent, band: scored.band ? scored.band.title : null, position, at: now };
    const consentSource = `Opted in on "${def.title}" (/s/${slug}) at ${now}: "${label}"`;
    const existing = await sb('GET', `/contacts?user_id=eq.${row.user_id}&email=eq.${encodeURIComponent(email)}&select=id,status,tags,custom_fields,first_name&limit=1`);
    if (!existing.ok) contactNote = 'contact_lookup_failed';
    else if (existing.data && existing.data[0]) {
      const c = existing.data[0];
      const patch = {
        tags: [...new Set([...(c.tags || []), ...tags])],
        custom_fields: { ...(c.custom_fields || {}), scorecards: { ...((c.custom_fields || {}).scorecards || {}), [slug]: record } },
        updated_at: now,
      };
      if (!c.first_name && firstName) patch.first_name = firstName;
      // A fresh, explicit opt-in re-subscribes someone who had unsubscribed.
      // A bounced or complained address is never put back on the list.
      if (c.status === 'subscribed' || c.status === 'unsubscribed') {
        Object.assign(patch, { status: 'subscribed', consent_source: consentSource, consent_timestamp: now });
        if (c.status === 'unsubscribed') patch.status_changed_at = now;
      } else contactNote = `kept_${c.status}`;
      const up = await sb('PATCH', `/contacts?id=eq.${c.id}`, patch);
      if (up.ok) contactId = c.id; else contactNote = 'contact_update_failed';
    } else {
      const made = await sb('POST', '/contacts', {
        user_id: row.user_id, intel_profile_id: row.intel_profile_id || null, project_id: row.intel_profile_id ? null : (row.project_id || null),
        email, first_name: firstName || null, tags, status: 'subscribed', source: 'scorecard',
        custom_fields: { scorecards: { [slug]: record } },
        consent_source: consentSource, consent_timestamp: now,
      });
      if (made.ok && made.data && made.data[0]) contactId = made.data[0].id; else contactNote = 'contact_create_failed';
    }
  }

  const saved = await sb('POST', '/scorecard_responses', {
    scorecard_id: row.id, user_id: row.user_id, email, first_name: firstName || null,
    answers: scored.answers, score: row.kind === 'scorecard' ? scored.score : null, max_score: row.kind === 'scorecard' ? scored.maxScore : null,
    percent: scored.percent, band_key: scored.band ? scored.band.key : null,
    source, campaign, consented, consent_text: consented ? label : null, contact_id: contactId, position,
  });
  if (!saved.ok) return res.status(500).json({ error: 'Your answers could not be saved. Please try again.' });

  const out = { ok: true, kind: row.kind, consented, saved: true };
  if (contactNote && /failed/.test(contactNote)) out.note = 'Your answers were saved, but we could not add you to the mailing list just now.';
  if (row.kind === 'waitlist') {
    out.position = position;
    out.message = def.waitlistMessage || `You're on the list for ${def.title}.`;
  } else {
    out.result = {
      percent: scored.percent,
      band: scored.band ? { title: scored.band.title, message: scored.band.message, nextStep: scored.band.nextStep } : null,
      categories: Object.entries(scored.categories).map(([name, c]) => ({ name, percent: c.percent })),
      cta: def.resultCta && def.resultCta.url ? def.resultCta : null,
    };
  }
  return res.json(out);
});

module.exports.publicView = publicView;
module.exports.consentLabel = consentLabel;
