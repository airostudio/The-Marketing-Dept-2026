/**
 * Merge-tag fallbacks + sender tokens, Business Brain contact people (1–5),
 * and the writing language / English variant every writing agent is given.
 *
 *   node tests/merge-language/run.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
let failures = 0;
function check(label, ok) { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`); if (!ok) failures++; }
const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8');

(async () => {
  const mf = require(path.join(REPO, 'api/_lib/merge-fields.js'));
  const guard = require(path.join(REPO, 'api/_lib/content-guard.js'));

  console.log('\n──── merge tags: fallbacks ────');
  check('a missing value uses the written fallback', mf.applyMergeFields('Hi {{firstName|there}},', {}) === 'Hi there,');
  check('a present value beats the fallback', mf.applyMergeFields('Hi {{firstName|there}},', { firstName: 'Sam' }) === 'Hi Sam,');
  check('whitespace around the tag and fallback is tolerated', mf.applyMergeFields('{{ area | your area }}', {}) === 'your area');
  check('no fallback on a non-optional token still stays visible (never silently blanked)', mf.applyMergeFields('{{area}}', {}) === '{{area}}');
  check('firstName with no fallback still blanks as before', mf.applyMergeFields('Hi {{firstName}},', {}) === 'Hi,');
  check('a fallback can never smuggle markup or another tag', mf.applyMergeFields('{{area|<b>x</b>}}', {}) === '{{area|<b>x</b>}}' && mf.applyMergeFields('{{area|{{x}}}}', {}) !== 'x');
  check('the send guard sees a bare tag but not one that has been filled', guard.findUnresolvedMergeTags('{{area}} {{company|x}}').length === 2 && guard.findUnresolvedMergeTags(mf.applyMergeFields('{{area|y}}', {})).length === 0);
  check('tokens needing a fallback are the non-optional ones without one', JSON.stringify(mf.tokensNeedingFallback('{{area}} {{firstName}} {{website|x}} {{senderName}} {{unsubscribe_url}}')) === '["area"]');
  check('sender tokens are known to the send system', ['senderName', 'senderFirstName', 'senderTitle', 'senderEmail', 'senderPhone', 'senderCompany'].every(t => mf.KNOWN_TOKENS.includes(t)));

  console.log('\n──── writing language: one list, browser and server identical ────');
  check('the server copy is byte-identical to the browser file', read('api/_lib/writing-language.js') === read('web/js/writing-language.js'));
  const wl = require(path.join(REPO, 'api/_lib/writing-language.js'));
  check('Australian English asks for AU spelling', /colour/.test(wl.directive('en-AU')) && /Australian/.test(wl.directive('en-AU')));
  check('US English asks for US spelling', /color/.test(wl.directive('en-US')) && !/colour/.test(wl.directive('en-US').replace(/\(color[^)]*\)/, '')));
  check('non-English languages are available', ['es', 'fr', 'de', 'pt-BR', 'it', 'nl'].every(c => wl.isSupported(c)));
  check('unset or unknown assumes nothing', wl.directive('') === '' && wl.directive('klingon') === '' && wl.directive({}) === '' && wl.directive(undefined) === '');
  check('prototype keys are not languages', !wl.isSupported('constructor') && !wl.isSupported('__proto__'));

  console.log('\n──── Business Brain: contact people and language ────');
  const store = {};
  const win = {
    WritingLanguage: wl,
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
    addEventListener() {}, dispatchEvent() {},
  };
  const src = read('web/js/intelligence-engine.js');
  let engine;
  try {
    engine = new Function('window', 'document', 'localStorage', `${src}\nreturn window.IntelligenceEngine || (typeof IntelligenceEngine!=='undefined' && IntelligenceEngine);`)(
      win, { readyState: 'complete', addEventListener() {}, querySelectorAll: () => [] }, win.localStorage);
  } catch (e) { console.log('  engine load error:', e.message); }
  const brain = engine && engine.brain;
  check('the engine loads', !!brain);
  if (brain) {
    const d = brain.load();
    d.company.name = 'Webese'; d.company.language = 'en-AU';
    d.sender = { name: 'Jane Doe', title: 'CEO', email: 'jane@w.co', phone: '1', mailingAddress: 'x' };
    d.team = { c2: { name: 'Sam Lee', title: 'Marketing Manager', email: 'sam@w.co' }, c3: { name: '  ' }, c5: { name: 'Kim Ng' } };
    brain.save(d);
    const people = brain.getContacts();
    check('contacts come back primary first, skipping blanks', people.map(p => p.name).join('|') === 'Jane Doe|Sam Lee|Kim Ng');
    check('there is a cap of five', brain.getContacts().length <= 5);
    const f = brain.getSenderMergeFields('c2');
    check('the chosen contact fills the sender tokens', f.senderName === 'Sam Lee' && f.senderFirstName === 'Sam' && f.senderTitle === 'Marketing Manager' && f.senderCompany === 'Webese');
    check('no choice = the primary contact', brain.getSenderMergeFields().senderName === 'Jane Doe');
    check('an unknown key falls back to the primary rather than a stranger', brain.getSenderMergeFields('c9').senderName === 'Jane Doe');
    check('the chosen language is reported', brain.getWritingLanguage() === 'en-AU');
    check('every agent inherits it through the business context', /WRITING LANGUAGE: .*Australian English/.test(brain.getContextSummary()));
    const bundle = engine.getContextBundle();
    check('the context bundle carries language, contacts and company', bundle.language === 'en-AU' && bundle.contacts.length === 3 && bundle.companyName === 'Webese');
    d.company.language = 'zz'; brain.save(d);
    check('a bad stored language is ignored, not passed to the prompt', brain.getWritingLanguage() === '' && !/WRITING LANGUAGE/.test(brain.getContextSummary()));
    const empty = new Function('window', 'document', 'localStorage', `${src}\nreturn window.IntelligenceEngine;`)(
      { ...win, localStorage: { getItem: () => null, setItem() {}, removeItem() {} } }, { readyState: 'complete', addEventListener() {}, querySelectorAll: () => [] }, { getItem: () => null, setItem() {}, removeItem() {} });
    check('with nothing configured there are no contacts and no language', empty.brain.getContacts().length === 0 && empty.brain.getWritingLanguage() === '');
  }

  const bb = read('web/intelligence/business-brain.html');
  check('the Brain has a language question fed from the shared list', /id="company-language"[^>]*data-path="company\.language"/.test(bb) && /WritingLanguage\.list\(\)/.test(bb));
  check('the Brain has five contact slots (1 required + 4 optional)', /Contact 1 — primary[\s\S]*required/.test(bb) && [2, 3, 4, 5].every(n => new RegExp(`data-path="team\\.c${n}\\.name"`).test(bb)));
  check('every page that loads the engine also loads the language list first', (() => {
    const files = require('child_process').execSync("grep -rl 'intelligence-engine.js' web --include=*.html", { cwd: REPO }).toString().trim().split('\n');
    return files.every(f => { const h = read(f); return h.indexOf('writing-language.js') !== -1 && h.indexOf('writing-language.js') < h.indexOf('intelligence-engine.js'); });
  })());

  console.log('\n──── Pat: contacts, tags and language reach the draft ────');
  const { buildCampaign, gateIssues, missingInputs } = require(path.join(REPO, 'api/_lib/pat-pipeline.js'));
  check('a company name alone no longer stands in for a contact person', missingInputs({ offer: 'x', companyName: 'Webese' }).some(q => q.field === 'sender'));
  check('a contact name satisfies it', missingInputs({ offer: 'x', senderName: 'Jane Doe' }).length === 0);
  check('a tag with a fallback passes the gate', gateIssues({ subject: 'Hi', html: '<p>Hi {{firstName|there}}, {{area|your area}}</p>', text: 'Hi {{firstName|there}}' }).length === 0);
  check('a bare {{area}} is blocked — it would skip recipients without one', gateIssues({ subject: 'Hi', html: '<p>In {{area}}</p>', text: 't' }).some(i => /fallback/.test(i)));
  check('an unknown tag is still blocked, with and without a fallback', gateIssues({ subject: 'Hi', html: '<p>{{nickname|x}}</p>', text: 't' }).some(i => /nickname/.test(i)));
  let seenUser = '', seenReview = null;
  const out = await buildCampaign({ offer: 'Free preview', senderName: 'Jane Doe', senderTitle: 'CEO', language: 'en-AU', expectedRecipients: 3 }, {
    draft: async ({ user }) => { seenUser = user; return { subject: 'Quick one', html: '<p>Hi {{firstName|there}},</p><p>Jane Doe, CEO</p>', text: 'Hi {{firstName|there}}' }; },
    review: async (a) => { seenReview = a; return { approved: true, blockers: [], warnings: [], summary: '' }; },
  });
  check('the drafter is told the sender, title and language', /Jane Doe/.test(seenUser) && /CEO/.test(seenUser) && /Australian English/.test(seenUser));
  check('the reviewer is told the expected language', seenReview && seenReview.language === 'en-AU');
  check('the preview uses the fallback-aware tags', out.preview.html.includes('Hi Sam,'));
  check('an unset language adds nothing to the drafter prompt', await (async () => { let u = ''; await buildCampaign({ offer: 'x', senderName: 'J' }, { draft: async ({ user }) => { u = user; return { subject: 's', html: '<p>x</p>', text: 'x' }; }, review: async () => ({ approved: true, blockers: [], warnings: [], summary: '' }) }); return !/WRITING LANGUAGE/.test(u); })());

  console.log('\n──── sending as a chosen contact ────');
  const ctx = { window: {} };
  const svcSrc = read('web/js/email-delivery-service.js');
  const svc = new Function('window', `${svcSrc}\nreturn EmailDeliveryService;`)({});
  const campaign = svc.collateCampaign({
    subject: 's', html: '<p>x</p>', recipients: [{ to: 'a@b.co', mergeFields: { firstName: 'A', senderName: 'HACK' } }, 'c@d.co'],
    senderFields: { senderName: 'Sam Lee', senderCompany: 'Webese' },
  });
  check('every recipient carries the chosen sender', campaign.recipients.every(r => r.mergeFields.senderName === 'Sam Lee' && r.mergeFields.senderCompany === 'Webese'));
  check('a recipient row cannot override who it is sent as', campaign.recipients[0].mergeFields.senderName === 'Sam Lee');
  check("the recipient's own fields survive", campaign.recipients[0].mergeFields.firstName === 'A');
  check('with no sender fields recipients are untouched', svc.collateCampaign({ subject: 's', html: 'x', recipients: ['a@b.co'] }).recipients[0].mergeFields === undefined);
  const pat = read('web/agents/email-delivery-agent.html');
  check('Pat has a Send-as picker fed by the Business Brain contacts', /id="in-sendas"/.test(pat) && /getContacts\?\.\(\)/.test(pat) && /senderFields: window\.IntelligenceEngine/.test(pat));

  console.log('\n──── Nancy writes in the chosen language ────');
  check('content-plan and edit-post both add the directive', ['api/nancy-content-plan.js', 'api/nancy-edit-post.js'].every(f => /languageDirective\(language\)/.test(read(f))));
  check('the Nancy page sends the Business Brain language with both requests', (read('web/agents/nancy-agent.html').match(/language: writingLanguage\(\)/g) || []).length === 2);

  console.log(failures === 0 ? '\nALL ASSERTIONS PASSED\n' : `\n${failures} FAILED\n`);
  process.exit(failures === 0 ? 0 : 1);
})();
