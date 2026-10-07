/**
 * The "New automation flow" screen: the logic that builds the create request
 * and the enrolment list, and the page wiring that must stay honest (draft
 * first, nothing sends until activated, no fake triggers).
 *
 *   node tests/flow-builder/run.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
let failures = 0;
function check(label, ok) { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`); if (!ok) failures++; }
const fb = require(path.join(REPO, 'web/js/flow-builder.js'));
const fm = require(path.join(REPO, 'api/_lib/flow-merge.js'));

const good = { name: 'Welcome', steps: [{ delayHours: 0, subject: 'Hi {{firstName|there}}', body: 'Welcome aboard.\n\nFrom {{senderName}}' }] };

console.log('\n──── text → email HTML ────');
check('blank lines make paragraphs, single newlines make breaks', fb.textToHtml('a\nb\n\nc') === '<p>a<br>b</p>\n<p>c</p>');
check('markup typed by the user is escaped, not injected', fb.textToHtml('<script>x</script> & "q"') === '<p>&lt;script&gt;x&lt;/script&gt; &amp; &quot;q&quot;</p>');
check('merge tags with fallbacks survive intact', fb.textToHtml('Hi {{firstName|there}}') === '<p>Hi {{firstName|there}}</p>');
check('empty text gives empty html', fb.textToHtml('  \n\n ') === '');

console.log('\n──── building the create request ────');
let r = fb.buildCreatePayload(good, { senderFields: { senderName: 'Jo' }, intelProfileId: 'p1' });
check('a good form builds a manual-trigger create request', r.errors.length === 0 && r.payload.action === 'create' && r.payload.triggerType === 'manual');
check('sender fields and profile are passed through', r.payload.senderFields.senderName === 'Jo' && r.payload.intelProfileId === 'p1');
check('what the server will check is what the screen produced (copy passes the server rules)', fm.copyIssues(r.payload.steps[0], { senderFields: r.payload.senderFields }).length === 0);
check('without a sender the server rejects the sender tag (so the screen\'s hint matters)', fm.copyIssues(fb.buildCreatePayload(good, {}).payload.steps[0], {}).some(i => /no sender/.test(i)));
check('optional from fields are omitted when blank', !('fromName' in r.payload) && !('fromEmail' in r.payload));
check('from fields are sent when given', fb.buildCreatePayload({ ...good, fromName: ' Jo ', fromEmail: 'jo@x.co' }).payload.fromName === 'Jo');
check('no name is an error', fb.buildCreatePayload({ ...good, name: ' ' }).errors.length === 1);
check('no emails is an error', fb.buildCreatePayload({ name: 'x', steps: [] }).errors.length === 1);
check('a step with no subject or body names which email', fb.buildCreatePayload({ name: 'x', steps: [{ delayHours: 0, subject: '', body: '' }] }).errors.join(' ').includes('Email 1 needs a subject'));
check('a negative delay is refused', fb.buildCreatePayload({ name: 'x', steps: [{ delayHours: -1, subject: 's', body: 'b' }] }).errors.length === 1);
check('a fractional delay is floored', fb.buildCreatePayload({ name: 'x', steps: [{ delayHours: 2.9, subject: 's', body: 'b' }] }).payload.steps[0].delayHours === 2);
check('the email limit matches the server', fb.MAX_STEPS === Number(/const MAX_STEPS = (\d+)/.exec(fs.readFileSync(path.join(REPO, 'api/email-flows.js'), 'utf8'))[1]));
check('every offered tag is one the send system knows, and has a fallback unless it must not', fb.TAGS.every(t => fm.copyIssues({ subject: 's', html: `<p>${t.tag}</p>` }, { senderFields: { senderName: 'a', senderTitle: 'b', senderCompany: 'c' } }).length === 0));

console.log('\n──── enrolling a segment ────');
const e = fb.enrolRecipients([
  { id: '1', email: 'a@x.co', status: 'subscribed' }, { id: '2', email: 'A@x.co', status: 'subscribed' },
  { id: '3', email: 'b@x.co', status: 'unsubscribed' }, { id: '4', email: '', status: 'subscribed' }, { id: '5', email: 'c@x.co' },
]);
check('only emailable, subscribed, unique contacts are enrolled', e.recipients.map(x => x.email).join() === 'a@x.co,c@x.co' && e.skipped === 3);
check('the contact id travels with the address', e.recipients[0].contactId === '1');
const many = fb.enrolRecipients(Array.from({ length: 600 }, (_, i) => ({ id: String(i), email: `u${i}@x.co`, status: 'subscribed' })));
check('a big segment is capped and says so', many.recipients.length === fb.MAX_ENROL && many.capped && many.total === 600);

console.log('\n──── the page ────');
const page = fs.readFileSync(path.join(REPO, 'web/marketing/email-marketing.html'), 'utf8');
check('flow-builder, language list and engine load, language list first', page.indexOf('writing-language.js') < page.indexOf('intelligence-engine.js') && /flow-builder\.js/.test(page));
check('there is a New flow button and form', /id="newFlowBtn"/.test(page) && /id="flowBuilder"/.test(page));
check('it says plainly that a new flow is a draft that sends nothing', /saved as a\s+<strong>draft<\/strong>: nothing sends until you activate it/.test(page));
check('there is no trigger picker advertising automatic enrolment that does not exist', !/id="flowTrigger"/.test(page));
check('the request goes through the authenticated helper, never a bare fetch', /authedFetch\('\/api\/email-flows', built\.payload\)/.test(page));
check('Activate / Pause and Enrol are only offered where they apply', /setFlowStatus\('\$\{esc\(f\.id\)\}','paused'\)/.test(page) && /f\.status === 'active' \? `\s*<select id="enrolSeg-/.test(page));
check('flow ids put into attributes are escaped', !/\$\{f\.id\}/.test(page.split('async function renderAutomations')[1].split('async function renderAbTests')[0]));
check('server problems are shown to the user (issues listed)', /r\.data\.issues/.test(page));

console.log(failures === 0 ? '\nALL ASSERTIONS PASSED\n' : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
