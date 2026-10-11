/**
 * api/_lib/apollo-client.js talks to Apollo's API-key people search
 * (mixed_people/api_search) with the documented domain list field, and never
 * passes an obscured surname off as a real one.
 *
 *   node tests/apollo-client/run.js
 */
'use strict';
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
let failures = 0;
function check(label, ok) { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`); if (!ok) failures++; }

(async () => {
  const apollo = require(path.join(REPO, 'api/_lib/apollo-client.js'));
  let sent = null, reply = {};
  global.fetch = async (url, opts) => { sent = { url: String(url), headers: opts.headers, body: JSON.parse(opts.body) }; return { ok: reply.status ? reply.status < 400 : true, status: reply.status || 200, json: async () => reply.body || {} }; };

  delete process.env.APOLLO_API_KEY;
  let threw = ''; try { await apollo.findPeopleByDomain('smith.com'); } catch (e) { threw = e.message; }
  check('without a key it refuses before calling Apollo', /APOLLO_API_KEY/.test(threw) && sent === null);

  process.env.APOLLO_API_KEY = 'k';
  reply = { body: { people: [
    { first_name: 'Jane', last_name_obfuscated: 'Sm***h', title: 'Owner' },
    { first_name: 'Sam', last_name: 'Lee', title: 'Founder', linkedin_url: 'https://www.linkedin.com/in/sam' },
  ] } };
  const r = await apollo.findPeopleByDomain('https://www.Smith.com/about');
  check('it calls the API-key people search endpoint', sent.url === 'https://api.apollo.io/api/v1/mixed_people/api_search');
  check('with the domain as a cleaned list, the key in the header, and owner-type titles', JSON.stringify(sent.body.q_organization_domains_list) === '["smith.com"]' && sent.headers['X-Api-Key'] === 'k' && sent.body.person_titles.includes('Owner'));
  check('an obscured surname is not shown: first name only, flagged', r.people[0].name === 'Jane' && r.people[0].firstName === 'Jane' && r.people[0].lastNameHidden === true && r.people[0].linkedinUrl === null);
  check('a full name and LinkedIn link are kept when Apollo returns them', r.people[1].name === 'Sam Lee' && !r.people[1].lastNameHidden && r.people[1].linkedinUrl === 'https://www.linkedin.com/in/sam');

  reply = { body: { people: [] } };
  check('nobody on file is an honest "not found"', (await apollo.findPeopleByDomain('nobody.com')).found === false);
  reply = { status: 403, body: { error: 'This endpoint is not available on your plan' } };
  threw = ''; try { await apollo.findPeopleByDomain('smith.com'); } catch (e) { threw = e.message; }
  check('an Apollo refusal is surfaced with Apollo\'s own reason', /not available on your plan/.test(threw));

  console.log(failures === 0 ? '\nALL ASSERTIONS PASSED\n' : `\n${failures} FAILED\n`);
  process.exit(failures === 0 ? 0 : 1);
})();
