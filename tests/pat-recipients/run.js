/**
 * Pat's paste-a-recipient-list parser and its new contact-enrichment step.
 *
 * parseRecipientList()'s placeholder text (web/agents/email-delivery-
 * agent.html) advertises "email, Name, firstName=Jane;company=Acme" as a
 * supported format, but the parser only ever split a line on the outer
 * comma — "firstName=Jane;company=Acme" arrived as ONE part, and
 * `p.split('=')` on it produced `["firstName", "Jane;company", "Acme"]`;
 * destructuring `[k, v]` silently set mergeFields.firstName = "Jane;company"
 * (garbage) and dropped company=Acme entirely. The semicolon-separated
 * multi-field syntax was advertised but never actually implemented.
 *
 * enrichRecipientsFromContacts() is the other half of "why isn't Pat
 * merging names" — a pasted list is very often just bare email addresses,
 * and the account frequently already has that person as a real contact
 * with a name on file; this looks each pasted address up and fills in
 * whatever the contacts table already has, without needing anyone to
 * retype data that already exists in the system.
 *
 *   node tests/pat-recipients/run.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..');
let failures = 0;
function check(label, ok) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failures++;
}

function loadModule(contactsStoreStub) {
  const fakeWindow = { ContactsStore: contactsStoreStub };
  const src = fs.readFileSync(path.join(REPO, 'web/js/email-delivery-service.js'), 'utf8');
  const fn = new Function('window', `${src}\nreturn window.EmailDeliveryService;`);
  return fn(fakeWindow);
}

console.log('\n──── parseRecipientList: the semicolon-separated field syntax actually works ────');
{
  const { parseRecipientList } = loadModule(null);

  const [r1] = parseRecipientList('jane@company.com, Jane, firstName=Jane;company=Acme');
  check('the email is parsed', r1.to === 'jane@company.com');
  check('the display name is parsed', r1.toName === 'Jane');
  check('firstName is extracted correctly (not corrupted with the next field)', r1.mergeFields && r1.mergeFields.firstName === 'Jane');
  check('company is ALSO extracted — this is the field the old parser silently dropped entirely', r1.mergeFields && r1.mergeFields.company === 'Acme');

  const [r2] = parseRecipientList('sam@x.test, firstName=Sam;lastName=Smith;company=Acme Corp');
  check('three semicolon-separated fields all come through', r2.mergeFields.firstName === 'Sam' && r2.mergeFields.lastName === 'Smith' && r2.mergeFields.company === 'Acme Corp');

  const [r3] = parseRecipientList('plain@x.test');
  check('a bare email with no fields still parses with no mergeFields', r3.to === 'plain@x.test' && r3.mergeFields === undefined);

  const [r4] = parseRecipientList('Jane Doe <jane@company.com>');
  check('the "Name <email>" format still works unaffected', r4.to === 'jane@company.com' && r4.toName === 'Jane Doe');
}

console.log('\n──── enrichRecipientsFromContacts: fills in what the account already has on file ────');
{
  const stub = {
    getContactsByEmail: async (emails) => {
      const known = { 'known@x.test': { email: 'known@x.test', first_name: 'Riley', last_name: 'Chen', company: 'Acme' } };
      return emails.map(e => known[e.trim().toLowerCase()]).filter(Boolean);
    },
  };
  const { enrichRecipientsFromContacts } = loadModule(stub);

  (async () => {
    const enriched = await enrichRecipientsFromContacts([
      { to: 'known@x.test' },
      { to: 'unknown@x.test' },
      { to: 'known@x.test', mergeFields: { firstName: 'Explicit' } }, // paste-supplied value must win
    ]);

    check('a bare pasted email with a matching contact gets enriched', enriched[0].mergeFields && enriched[0].mergeFields.firstName === 'Riley');
    check('company and lastName are filled in too', enriched[0].mergeFields.lastName === 'Chen' && enriched[0].mergeFields.company === 'Acme');
    check('a toName is derived from the contact when none was pasted', enriched[0].toName === 'Riley Chen');
    check('an address with no matching contact is left alone, not crashed on', enriched[1].to === 'unknown@x.test' && enriched[1].mergeFields === undefined);
    check('a value EXPLICITLY given in the paste is never overwritten by the contacts lookup', enriched[2].mergeFields.firstName === 'Explicit');

    console.log('\n──── a failed lookup degrades gracefully, never blocks sending ────');
    const brokenStub = { getContactsByEmail: async () => { throw new Error('not signed in'); } };
    const { enrichRecipientsFromContacts: enrichBroken } = loadModule(brokenStub);
    const original = [{ to: 'a@x.test' }];
    const result = await enrichBroken(original);
    check('the original recipient list comes back unchanged, not thrown', result === original || (result.length === 1 && result[0].to === 'a@x.test'));

    console.log('\n──── no ContactsStore available (not loaded/offline) is a silent no-op ────');
    const { enrichRecipientsFromContacts: enrichNoStore } = loadModule(null);
    const passthrough = await enrichNoStore([{ to: 'a@x.test' }]);
    check('recipients pass through unchanged', passthrough.length === 1 && passthrough[0].to === 'a@x.test');

    console.log(failures === 0 ? '\nALL ASSERTIONS PASSED\n' : `\n${failures} FAILED\n`);
    process.exit(failures === 0 ? 0 : 1);
  })();
}
