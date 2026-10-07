/**
 * web/agents/audience-agent.html's Content Calendar tab used to only ever
 * show 'approved' posts, on the assumption a separate review queue in
 * Social Studio (social-agent.html) was where 'pending_review' posts got
 * approved first. That queue is actually a local, in-memory array
 * (_reviewPosts) populated only by Social Studio's OWN generation calls in
 * the current browser tab — it never loads existing pending_review rows
 * from the database, so a post written by any other agent (Nancy
 * included) had no approve button anywhere a person could actually find
 * it. This checks that the Content Calendar is now the one real front
 * door: it loads pending_review posts too, and can approve them itself
 * (one at a time, or in bulk) rather than requiring a trip to a queue that
 * never shows them.
 *
 *   node tests/content-calendar-approval/run.js
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

const page = fs.readFileSync(path.join(REPO, 'web/agents/audience-agent.html'), 'utf8');

console.log('\n──── the calendar loads what actually needs a decision, not just already-approved posts ────');
check('loadCalendar fetches pending_review posts', /listPosts\(\{ status: 'pending_review' \}\)/.test(page));
check('loadCalendar still fetches approved-but-unscheduled posts too', /listPosts\(\{ status: 'approved' \}\)/.test(page));
check('the two lists are merged into one queue', /unscheduledPosts = \[\.\.\.pending, \.\.\.approved\.filter/.test(page));

console.log('\n──── pending posts get real approve/reject actions, not a dead end ────');
check('approvePost exists and calls updateStatus with \'approved\'', /async function approvePost\(postId\) \{[\s\S]{0,200}updateStatus\(postId, 'approved'\)/.test(page));
check('rejectPost exists and calls updateStatus with \'rejected\'', /async function rejectPost\(postId\) \{[\s\S]{0,300}updateStatus\(postId, 'rejected'\)/.test(page));
check('rejecting asks for confirmation first (a destructive-ish action)', /rejectPost\(postId\) \{\s*if \(!confirm\(/.test(page));

console.log('\n──── a card still awaiting review shows Approve/Reject, not a time picker it cannot use yet ────');
check('needsApproval branches the card to Approve/Reject buttons', /needsApproval \? `[\s\S]{0,200}AM\.approvePost/.test(page));
check('an already-approved card still gets the time picker + Set Time, unchanged', /AM\.setPostSchedule/.test(page));
check('each card shows which status it is actually in', /Needs approval.*Approved|Approved.*Needs approval/.test(page) || (/'Needs approval'/.test(page) && /'Approved'/.test(page)));

console.log('\n──── bulk approval: a fast pass through a whole batch ────');
check('Approve All button exists and is wired to AM.approveAll()', /id="btn-approve-all"[\s\S]{0,60}onclick="AM\.approveAll\(\)"/.test(page));
check('Approve Selected button exists and is wired to AM.approveSelected()', /id="btn-approve-selected"[\s\B]{0,60}onclick="AM\.approveSelected\(\)"/.test(page) || /onclick="AM\.approveSelected\(\)"/.test(page));
check('approveAll only targets posts still pending (never re-approves or touches scheduled ones)', /approveAll\(\) \{[\s\S]{0,200}filter\(p => p\.status === 'pending_review'\)/.test(page));
check('approveAll asks for confirmation before bulk-approving', /approveAll\(\) \{[\s\S]{0,400}confirm\(/.test(page));
check('approveSelected only approves checked rows that are actually pending', /approveSelected\(\) \{[\s\S]{0,250}status === 'pending_review'/.test(page));
check('bulk approval reports partial failures rather than a false "all done"', /failed\.length/.test(page) && /could not be approved/.test(page));
check('every selectable post has a real checkbox the bulk actions can read', /class="cal-select" data-post-id/.test(page) && /\.cal-select:checked/.test(page));

console.log('\n──── the new functions are actually exposed to the onclick handlers that call them ────');
check('approvePost/rejectPost/approveAll/approveSelected are all exported on AM', /approvePost, rejectPost, approveAll, approveSelected,/.test(page));

console.log(failures === 0 ? '\nALL ASSERTIONS PASSED\n' : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
