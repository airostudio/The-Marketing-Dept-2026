/**
 * Scorecards & waitlists: the rules (api/_lib/scorecard.js), the public
 * endpoint visitors use (api/scorecard-public.js), the owner endpoint
 * (api/scorecards.js), the Scotty draft (api/_lib/scorecard-draft.js) and the
 * two pages. Scores are computed on the server, consent is never a condition
 * of a result, and only a consented visitor becomes a contact.
 *
 *   node tests/scorecards/run.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
let failures = 0;
function check(label, ok) { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`); if (!ok) failures++; }
function mockModule(rel, exp) { const p = require.resolve(path.join(REPO, rel)); require.cache[p] = { id: p, filename: p, loaded: true, exports: exp }; }
const clone = (x) => JSON.parse(JSON.stringify(x));

const OWNER = '11111111-1111-1111-1111-111111111111';
const STRANGER = '44444444-4444-4444-4444-444444444444';
const PROJECT = '66666666-6666-6666-6666-666666666666';

/* ── a tiny in-memory PostgREST ─────────────────────────────────────────── */
const db = { scorecards: [], scorecard_responses: [], contacts: [], segments: [], projects: [{ id: PROJECT, user_id: OWNER }], intelligence_profiles: [], intelligence_profile_members: [] };
let nextId = 1; const uuid = () => `abababab-abab-abab-abab-${String(nextId++).padStart(12, '0')}`;
let failTable = null;
function filterRows(rows, qs) {
  const params = new URLSearchParams(qs);
  let out = rows.slice();
  for (const [k, v] of params) {
    if (['select', 'order', 'limit'].includes(k)) continue;
    if (k === 'or') {
      const m = v.match(/^\(user_id\.eq\.([^,]+),intel_profile_id\.in\.\(([^)]*)\)\)$/);
      out = out.filter(r => r.user_id === m[1] || m[2].split(',').includes(r.intel_profile_id));
      continue;
    }
    if (v.startsWith('eq.')) out = out.filter(r => String(r[k]) === v.slice(3));
    else if (v.startsWith('in.(')) { const set = v.slice(4, -1).split(','); out = out.filter(r => set.includes(String(r[k]))); }
    else if (v.startsWith('gte.')) out = out.filter(r => r[k] >= v.slice(4));
    else if (v === 'not.is.null') out = out.filter(r => r[k] != null);
  }
  const order = params.get('order');
  if (order) { const [col, dir] = order.split('.'); out.sort((a, b) => (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0) * (dir === 'desc' ? -1 : 1)); }
  const limit = Number(params.get('limit')); if (limit) out = out.slice(0, limit);
  return out;
}
mockModule('api/_lib/supabase-rest.js', {
  isUuid: (v) => /^[0-9a-f-]{36}$/i.test(String(v)),
  sbRest: async (u, k, method, p, body) => {
    const [tablePath, qs = ''] = p.split('?');
    const table = tablePath.slice(1);
    if (failTable === table) return { ok: false, status: 500, data: null };
    const rows = db[table] || (db[table] = []);
    if (method === 'GET') return { ok: true, status: 200, data: clone(filterRows(rows, qs)) };
    if (method === 'POST') {
      const list = Array.isArray(body) ? body : [body];
      const made = list.map(b => ({ id: uuid(), created_at: new Date(Date.now() + nextId).toISOString(), ...clone(b) }));
      rows.push(...made); return { ok: true, status: 201, data: clone(made) };
    }
    if (method === 'PATCH') { const hit = filterRows(rows, qs); hit.forEach(r => Object.assign(r, clone(body))); return { ok: true, status: 200, data: clone(hit) }; }
    if (method === 'DELETE') { const hit = filterRows(rows, qs); db[table] = rows.filter(r => !hit.includes(r)); return { ok: true, status: 200, data: clone(hit) }; }
    return { ok: false, status: 400, data: null };
  },
});
mockModule('api/_lib/report-failure.js', { withFailureReporting: (n, h) => h, reportFailureAsync() {}, reportFailure() {} });
let claudeCalls = [], draftReply = null;
mockModule('api/_lib/nancy-claude.js', { callClaudeForJSON: async (a) => { claudeCalls.push(a); return draftReply instanceof Error ? { success: false, error: draftReply.message } : { success: true, data: clone(draftReply) }; }, asUntrustedContent: (t) => `<<${t}>>`, UNTRUSTED_CONTENT_RULE: 'UNTRUSTED' });
global.fetch = async (url) => (String(url).includes('/auth/v1/user') && global.__callerId) ? { ok: true, json: async () => ({ id: global.__callerId }) } : { ok: false };
Object.assign(process.env, { SUPABASE_URL: 'https://x.test', SUPABASE_SERVICE_ROLE_KEY: 'svc', ANTHROPIC_API_KEY: 'k', SCORECARD_SECRET: 'test-secret' });
const { resetForTests } = require(path.join(REPO, 'api/_lib/rate-limit.js'));
function load(n) { const p = path.join(REPO, `api/${n}.js`); delete require.cache[require.resolve(p)]; return require(p); }
function res() { const r = { statusCode: 200, headers: {} }; r.status = (c) => { r.statusCode = c; return r; }; r.json = (d) => { r.body = d; return r; }; r.setHeader = (k, v) => { r.headers[k] = v; }; r.end = () => r; return r; }
let ipN = 1;
async function call(h, who, body, opts = {}) { global.__callerId = who; const r = res(); await h({ method: opts.method || 'POST', headers: { ...(opts.noAuth ? {} : { authorization: 'Bearer t' }), 'x-real-ip': opts.ip || `10.0.0.${ipN++ % 250}` }, query: opts.query || {}, body }, r); return r; }

const sc = require(path.join(REPO, 'api/_lib/scorecard.js'));
const DEF = {
  kind: 'scorecard', title: 'Website Health Check', businessName: 'Webese',
  intro: { headline: 'Is your website winning you customers?', bullets: ['Takes 2 minutes'] },
  questions: [
    { id: 'mobile', prompt: 'Does your site work well on phones?', type: 'single', category: 'Basics', options: [{ id: 'no', label: 'No', points: 0 }, { id: 'unsure', label: 'Not sure', points: 3 }, { id: 'yes', label: 'Yes', points: 10 }] },
    { id: 'channels', prompt: 'Where do customers find you?', type: 'multi', category: 'Reach', options: [{ id: 'google', label: 'Google', points: 5 }, { id: 'social', label: 'Social', points: 5 }, { id: 'none', label: 'Word of mouth only', points: 0 }] },
    { id: 'confidence', prompt: 'How confident are you in your site?', type: 'scale', min: 1, max: 5 },
    { id: 'wish', prompt: 'Anything else?', type: 'text', required: false },
  ],
  bands: [{ title: 'Needs work', min: 0, max: 40, message: 'Start with mobile.' }, { title: 'Getting there', min: 41, max: 70, message: 'Good base.' }, { title: 'Strong', min: 71, max: 100, message: 'Great.' }],
};

(async () => {
  console.log('\n──── the rules ────');
  const { def, problems } = sc.normalize(DEF);
  check('a complete scorecard has nothing stopping it', problems.length === 0);
  const p = (over) => sc.normalize({ ...DEF, ...over }).problems.join(' | ');
  check('a gap between result bands is caught', /No result band covers 41%–50%/.test(p({ bands: [{ title: 'A', min: 0, max: 40 }, { title: 'B', min: 51, max: 100 }] })));
  check('overlapping bands are caught', /overlap at 30%/.test(p({ bands: [{ title: 'A', min: 0, max: 40 }, { title: 'B', min: 30, max: 100 }] })));
  check('bands that stop short of 100% are caught', /91%–100%/.test(p({ bands: [{ title: 'A', min: 0, max: 90 }] })));
  check('a choice question needs two answers', /needs at least two answers/.test(p({ questions: [{ prompt: 'Q', type: 'single', options: [{ label: 'only', points: 5 }] }] })));
  check('visitors must be told whose page it is', /business name/.test(p({ businessName: '' })));
  check('a scorecard where nothing scores is caught', /at least one question that scores/.test(p({ questions: [{ prompt: 'Q', type: 'text' }] })));
  check('a result button must be https', /https:\/\//.test(p({ resultCta: { label: 'Call', url: 'http://x.com' } })));
  check('a waitlist needs no bands and scores nothing', sc.normalize({ ...DEF, kind: 'waitlist', bands: [] }).problems.length === 0 && sc.normalize({ ...DEF, kind: 'waitlist' }).def.questions[0].options.every(o => o.points === 0));
  check('slugs are tidy', sc.slugify('  Café Website — Health Check!! ') === 'cafe-website-health-check' && sc.SLUG_RE.test('cafe-website-health-check') && !sc.SLUG_RE.test('-x') && !sc.SLUG_RE.test('ab'));

  const s1 = sc.scoreAnswers(def, { mobile: 'yes', channels: ['google', 'social', 'google'], confidence: 4, score: 9999 });
  check('answers are scored on the server: 10 + 10 + 4 of 25 = 96%', s1.ok && s1.score === 24 && s1.maxScore === 25 && s1.percent === 96 && s1.band.key === 'strong');
  check('a score sent by the browser is ignored', !('score' in s1.answers));
  check('duplicate picks count once, and sub-scores are per category', s1.answers.channels.length === 2 && s1.categories.Basics.percent === 100 && s1.categories.Reach.percent === 100);
  const s2 = sc.scoreAnswers(def, { mobile: 'maybe', channels: ['hack'], confidence: 9 });
  check('made-up answers are rejected, and required ones are asked for', !s2.ok && s2.problems.length === 3);
  const s3 = sc.scoreAnswers(def, { mobile: 'no', channels: ['none'], confidence: 1, wish: 'x'.repeat(900) });
  check('a low score lands in the low band; long text is trimmed', s3.percent === 4 && s3.band.key === 'needs-work' && s3.answers.wish.length === 500);
  check('tags name the scorecard, the result and each single choice', JSON.stringify(sc.tagsFor('website-health', def, s1)) === JSON.stringify(['scorecard:website-health', 'scorecard:website-health:strong', 'scorecard:website-health:mobile-yes']));

  const tok = sc.signStart('website-health', Date.now() - 10000);
  check('a start token from 10 seconds ago is fine', sc.checkStart('website-health', tok) === '');
  check('a submission faster than a person can answer is refused', /quicker/.test(sc.checkStart('website-health', sc.signStart('website-health'))));
  check('a token for another page, or forged, is refused', /reload/.test(sc.checkStart('other-page', tok)) && /reload/.test(sc.checkStart('website-health', tok.replace(/.$/, 'x'))));
  check('a day-old page must be reloaded', /reload/.test(sc.checkStart('website-health', sc.signStart('website-health', Date.now() - 25 * 3600 * 1000))));

  const sum = sc.summarize(def, [
    { email: 'a@x.com', answers: s1.answers, percent: 96, band_key: 'strong', source: 'email', campaign: 'oct', consented: true },
    { email: 'A@x.com', answers: s3.answers, percent: 4, band_key: 'needs-work', source: null, consented: false },
  ]);
  check('totals are counts: responses, people (case-insensitive), opted in, average', sum.responses === 2 && sum.people === 1 && sum.consented === 1 && sum.averagePercent === 50);
  check('…by result, source, campaign and answer', sum.bands.strong.count === 1 && sum.sources.direct === 1 && sum.campaigns.oct === 1 && sum.questions[0].options.find(o => o.id === 'yes').count === 1 && sum.questions[2].average === 2.5);

  console.log('\n──── the owner side ────');
  const own = load('scorecards'), pub = load('scorecard-public');
  check('no session is refused', (await call(own, null, { action: 'list' }, { noAuth: true })).statusCode === 401);
  check('without a business profile or project it stops, saying why', (await call(own, OWNER, { action: 'save', definition: DEF })).body.code === 'no_scope');
  const made = await call(own, OWNER, { action: 'save', definition: DEF, projectId: PROJECT });
  const card = made.body.scorecard;
  check('a new scorecard is saved as a draft with a slug from its title', card.status === 'draft' && card.slug === 'website-health-check' && card.problems.length === 0);
  const made2 = await call(own, OWNER, { action: 'save', definition: DEF, projectId: PROJECT });
  check('a taken slug gets a number, never a clash', made2.body.scorecard.slug === 'website-health-check-2');
  check('a draft is not public', (await call(pub, null, null, { method: 'GET', query: { slug: card.slug } })).statusCode === 404);
  check('a stranger cannot open it', (await call(own, STRANGER, { action: 'get', id: card.id })).statusCode === 404);
  const broken = await call(own, OWNER, { action: 'save', definition: { ...DEF, bands: [] }, projectId: PROJECT });
  check('something unpublishable can be saved as a draft but not published', broken.body.scorecard.problems.length > 0 && (await call(own, OWNER, { action: 'publish', id: broken.body.scorecard.id })).statusCode === 422);

  const pubd = await call(own, OWNER, { action: 'publish', id: card.id });
  const segs = db.segments.filter(s => s.user_id === OWNER);
  check('publishing puts it live at /s/<slug>', pubd.body.path === '/s/website-health-check' && db.scorecards.find(x => x.id === card.id).status === 'live');
  check('…and makes a follow-up segment for everyone and one per result', segs.length === 4 && segs.some(s => JSON.stringify(s.filter_rules) === JSON.stringify({ tagsAll: ['scorecard:website-health-check'], status: 'subscribed' })) && segs.some(s => s.filter_rules.tagsAll[0] === 'scorecard:website-health-check:strong') && segs.every(s => s.project_id === PROJECT && s.member_mode === 'dynamic'));
  await call(own, OWNER, { action: 'publish', id: card.id });
  check('publishing again does not duplicate the segments', db.segments.length === 4);
  check('a live scorecard cannot be edited into a broken one', (await call(own, OWNER, { action: 'save', id: card.id, definition: { ...DEF, questions: [] } })).statusCode === 422);
  check('a published one cannot be deleted (its link may be out there)', (await call(own, OWNER, { action: 'delete', id: card.id })).statusCode === 409);
  check('a draft can be deleted', (await call(own, OWNER, { action: 'delete', id: made2.body.scorecard.id })).body.ok && !db.scorecards.some(x => x.id === made2.body.scorecard.id));

  console.log('\n──── the public page ────');
  resetForTests();
  const g = await call(pub, null, null, { method: 'GET', query: { slug: card.slug } });
  const pubDef = g.body.scorecard;
  check('a live scorecard loads with a start token', g.body.status === 'live' && /^\d+\./.test(g.body.startToken));
  check('the points behind each answer are never sent to the browser', pubDef.questions[0].options.every(o => !('points' in o)) && !JSON.stringify(g.body).includes('"points"'));
  check('owner ids, segments and groups are not exposed', !JSON.stringify(g.body).includes(OWNER) && !('segment_ids' in pubDef));
  check('the consent wording names the business', /from Webese/.test(pubDef.consentLabel));
  check('an unknown slug is a plain 404', (await call(pub, null, null, { method: 'GET', query: { slug: 'nope-nope' } })).statusCode === 404);

  const ok = sc.signStart(card.slug, Date.now() - 20000);
  const answers = { mobile: 'yes', channels: ['google'], confidence: 3 };
  const submit = (over) => call(pub, null, { slug: card.slug, answers, email: 'Jane@Example.com', firstName: 'Jane', consent: false, startToken: ok, src: 'instagram', c: 'oct-launch', ...over });

  let r = await submit({ website: 'http://spam' });
  check('a bot that fills the hidden field is answered politely and nothing is stored', r.body.ok && db.scorecard_responses.length === 0);
  r = await submit({ startToken: sc.signStart(card.slug) });
  check('an instant submission is refused', r.statusCode === 400 && r.body.code === 'start_token');
  check('a bad email is refused', (await submit({ email: 'nope' })).statusCode === 400);
  check('missing required answers are refused', (await submit({ answers: { mobile: 'yes' } })).statusCode === 400);

  r = await submit({});
  const resp1 = db.scorecard_responses[0];
  check('without consent they still get their result: 10 + 5 + 3 of 25 = 72%, "Strong"', r.body.ok && r.body.result.percent === 72 && r.body.result.band.title === 'Strong' && r.body.consented === false);
  check('…their answers are kept for the business, with where they came from', resp1.percent === 72 && resp1.source === 'instagram' && resp1.campaign === 'oct-launch' && resp1.email === 'jane@example.com' && resp1.consented === false);
  check('…but no contact is created and nobody will be emailed', db.contacts.length === 0 && resp1.contact_id === null);

  r = await submit({ consent: true, src: 'carrier-pigeon' });
  const c = db.contacts[0];
  check('with consent they become a subscribed contact of the business', c && c.status === 'subscribed' && c.user_id === OWNER && c.project_id === PROJECT && c.source === 'scorecard' && c.email === 'jane@example.com' && c.first_name === 'Jane');
  check('…tagged by scorecard, result and choice, so segments and flows pick them up', c.tags.includes('scorecard:website-health-check') && c.tags.includes('scorecard:website-health-check:strong') && c.tags.includes('scorecard:website-health-check:mobile-yes'));
  check('…with the exact words they agreed to and when, recorded as their consent', c.consent_source.includes(pubDef.consentLabel) && !!c.consent_timestamp && db.scorecard_responses[1].consent_text === pubDef.consentLabel);
  check('…and the result on the contact', c.custom_fields.scorecards['website-health-check'].percent === 72);
  check('an unknown source is recorded as "other"', db.scorecard_responses[1].source === 'other');

  await submit({ consent: true });
  const stored = db.scorecard_responses.filter(x => x.email === 'jane@example.com').length;
  r = await submit({ consent: true });
  check('a fourth try within ten minutes is slowed down', stored === 3 && r.statusCode === 429);

  db.contacts.push({ id: uuid(), user_id: OWNER, email: 'gone@example.com', status: 'unsubscribed', tags: ['old'], custom_fields: {} });
  db.contacts.push({ id: uuid(), user_id: OWNER, email: 'bounce@example.com', status: 'bounced', tags: [], custom_fields: {} });
  resetForTests();
  await submit({ email: 'gone@example.com', consent: true });
  const gone = db.contacts.find(x => x.email === 'gone@example.com');
  check('someone who had unsubscribed and now explicitly opts in is subscribed again, keeping their old tags', gone.status === 'subscribed' && gone.tags.includes('old') && gone.tags.includes('scorecard:website-health-check') && !!gone.status_changed_at);
  await submit({ email: 'bounce@example.com', consent: true });
  check('a bounced address is never put back on the list', db.contacts.find(x => x.email === 'bounce@example.com').status === 'bounced');

  await call(own, OWNER, { action: 'close', id: card.id });
  check('a closed scorecard says so and takes no more answers', (await call(pub, null, null, { method: 'GET', query: { slug: card.slug } })).body.status === 'closed' && (await submit({ email: 'late@example.com' })).statusCode === 404);
  await call(own, OWNER, { action: 'reopen', id: card.id });

  console.log('\n──── waitlists ────');
  const W = { kind: 'waitlist', title: 'Idea A', businessName: 'Webese', group: 'ideas', intro: { headline: 'Websites in 7 days' }, questions: [{ id: 'pay', prompt: 'What would you pay?', type: 'single', options: [{ id: 'low', label: 'Under 500' }, { id: 'high', label: '500+' }] }] };
  const wa = (await call(own, OWNER, { action: 'save', definition: W, projectId: PROJECT })).body.scorecard;
  const wb = (await call(own, OWNER, { action: 'save', definition: { ...W, title: 'Idea B' }, projectId: PROJECT })).body.scorecard;
  await call(own, OWNER, { action: 'publish', id: wa.id }); await call(own, OWNER, { action: 'publish', id: wb.id });
  resetForTests();
  const join = (slug, email, pay) => call(pub, null, { slug, answers: { pay }, email, consent: true, startToken: sc.signStart(slug, Date.now() - 9000) });
  const j1 = await join(wa.slug, 'a@x.com', 'high'), j2 = await join(wa.slug, 'b@x.com', 'high'), j3 = await join(wa.slug, 'a@x.com', 'high');
  await join(wb.slug, 'c@x.com', 'low');
  check('people get their real place in line', j1.body.position === 1 && j2.body.position === 2);
  check('joining twice keeps your place and does not add a person', j3.body.position === 1);
  check('a waitlist has no score', j1.body.result === undefined && db.scorecard_responses.filter(x => x.scorecard_id === wa.id).every(x => x.percent === null));
  const cmp = await call(own, OWNER, { action: 'compare', group: 'ideas' });
  check('two waitlists in a group compare by real people and answers', cmp.body.items.length === 2 && cmp.body.items[0].totals.people === 2 && cmp.body.items[1].totals.people === 1 && cmp.body.items[0].totals.questions[0].options.find(o => o.id === 'high').count === 3);

  const rs = await call(own, OWNER, { action: 'results', id: card.id });
  check('results show totals and the latest responses', rs.body.totals.responses >= 4 && rs.body.recent[0].email && rs.body.totals.sources.instagram === db.scorecard_responses.filter(x => x.scorecard_id === card.id && x.source === 'instagram').length && rs.body.totals.sources.other === 1);
  const list = await call(own, OWNER, { action: 'list' });
  check('the list counts responses and opt-ins per scorecard', list.body.scorecards.find(x => x.id === wa.id).responses === 3 && list.body.scorecards.find(x => x.id === wa.id).consented === 3);
  check('a stranger sees none of it', (await call(own, STRANGER, { action: 'list' })).body.scorecards.length === 0 && (await call(own, STRANGER, { action: 'results', id: card.id })).statusCode === 404);

  console.log('\n──── Draft with Scotty ────');
  check('drafting needs a topic and a business name, before any model call', (await call(own, OWNER, { action: 'draft', kind: 'scorecard', businessName: 'Webese' })).statusCode === 400 && (await call(own, OWNER, { action: 'draft', topic: 'Website health' })).statusCode === 400 && claudeCalls.length === 0);
  draftReply = { ...DEF, intro: { headline: '73% of small business websites lose customers' } };
  const cardsBefore = db.scorecards.length;
  const dr = await call(own, OWNER, { action: 'draft', kind: 'scorecard', topic: 'Website health', businessName: 'Webese', businessContext: 'We build websites in Leeds.' });
  check('a draft comes back to edit, not saved', dr.body.ok && dr.body.definition.title === 'Website Health Check' && db.scorecards.length === cardsBefore);
  check('an invented statistic in visitor-facing text is flagged', dr.body.warnings.some(w => /73%/.test(w)));
  check('the business details reach the model fenced as data, with the no-invented-figures rule', /<<We build websites in Leeds/.test(claudeCalls[0].user) && /Never invent statistics/.test(claudeCalls[0].system));
  draftReply = { ...W, kind: 'scorecard' };
  await call(own, OWNER, { action: 'draft', kind: 'waitlist', topic: 'Websites in 7 days', businessName: 'Webese' });
  check('a waitlist draft uses the validation brief and never claims a launch date', /not built yet/.test(claudeCalls[1].system) && /without promising a date/.test(claudeCalls[1].system));

  console.log('\n──── the pages ────');
  const page = fs.readFileSync(path.join(REPO, 'web/scorecard.html'), 'utf8');
  const js = page.split('<script>').pop();
  check('the public page puts every business and visitor text on the page as text, never HTML', !/innerHTML/.test(js) && /textContent/.test(js));
  check('the consent box starts unticked and the result does not depend on it', /type: 'checkbox' \}\);\s*\/\/ unticked/.test(js) && !/consent\.checked\s*\)\s*\{\s*err/.test(js));
  check('the hidden honeypot field is sent', /website: hp\.value/.test(js) && /class: 'hp'/.test(js));
  check('only https links become buttons', /safeHttps\(r\.cta\.url\)/.test(js));
  check('the channel and campaign from the link are passed on', /src: params\.get\('src'\)/.test(js) && /c: params\.get\('c'\)/.test(js));
  const vercel = JSON.parse(fs.readFileSync(path.join(REPO, 'vercel.json'), 'utf8'));
  check('/s/<slug> is routed to the page, ahead of the catch-all', vercel.rewrites[0].source === '/s/:slug' && vercel.rewrites[0].destination === '/scorecard.html');
  const builder = fs.readFileSync(path.join(REPO, 'web/marketing/scorecards.html'), 'utf8');
  const bjs = builder.split('<script>').pop();
  // Lines that build HTML: anything interpolated there must go through esc(). (textContent and URL building are safe already.)
  const htmlLines = bjs.split('\n').filter(l => /innerHTML|`\s*$|^\s*<|<\/?[a-z]/.test(l) && !/textContent|new URL\(|const base =/.test(l));
  const raw = htmlLines.flatMap(l => [...l.matchAll(/\$\{(?!esc\()([^}]*?(?:title|label|prompt|email|firstName|message|campaign|group|slug)[^}]*)\}/g)].map(m => m[1])).filter(x => !/esc\(|shareUrl|pct\(|\.length|=>|\?/.test(x));
  check('the builder escapes everything it shows', raw.length === 0);
  if (raw.length) console.log('      ', raw);
  check('the builder loads the auth helpers it uses', /send-auth\.js/.test(builder) && /failure-reporter\.js/.test(builder));
  check('the marketing sidebar links to it', /href="\/marketing\/scorecards\.html"/.test(fs.readFileSync(path.join(REPO, 'web/marketing/email-marketing.html'), 'utf8')));
  check('the tables are in the installer', /CREATE TABLE IF NOT EXISTS scorecard_responses/.test(fs.readFileSync(path.join(REPO, 'supabase-install-all.sql'), 'utf8')));

  console.log(failures === 0 ? '\nALL ASSERTIONS PASSED\n' : `\n${failures} FAILED\n`);
  process.exit(failures === 0 ? 0 : 1);
})();
