# LinkedIn Prospecting Tool - Phase 1 Testing Plan

**Created:** February 10, 2026
**Version:** Phase 1.0
**Status:** Ready for Testing
**Goal:** Commercial-Grade Reliability Verification

---

## PHASE 1 FEATURES IMPLEMENTED

### ✅ 1. CSV Import with Column Mapping
- Upload CSV files from LinkedIn/CRM exports
- Automatic column mapping detection
- Preview before import
- Configurable import options
- Detailed import results reporting

### ✅ 2. Browser Notifications for Follow-ups
- Request notification permission
- Daily follow-up reminders at 9 AM
- Notifications for overdue prospects
- Auto-dismiss after 10 seconds
- Prospect added success notifications

### ✅ 3. Duplicate Detection
- Detect duplicates by LinkedIn URL (highest reliability)
- Detect duplicates by email (high reliability)
- Detect duplicates by name + company (moderate reliability)
- Warn user before adding duplicate
- Skip duplicates during CSV import

### ✅ 4. Enhanced Data Validation
- LinkedIn URL format validation
- Email format validation
- Phone number format validation (basic)
- Field length validation
- Required field enforcement
- Warning messages for data quality issues

---

## TESTING METHODOLOGY

### Test Levels:
1. **Unit Tests** - Individual function testing
2. **Integration Tests** - Feature interaction testing
3. **User Acceptance Tests** - Real-world scenario testing
4. **Performance Tests** - Load and stress testing
5. **Security Tests** - Data safety verification

### Test Priorities:
- **P0 (Critical):** Must pass for release
- **P1 (High):** Should pass for quality
- **P2 (Medium):** Nice to have working
- **P3 (Low):** Enhancement validation

---

## TEST PLAN 1: CSV IMPORT

### Test 1.1: Valid CSV Import (P0 - Critical)

**Scenario:** Import a well-formed CSV with prospect data

**Test Data:**
```csv
Name,Company,Job Title,Email,LinkedIn URL
John Smith,Acme Corp,VP Marketing,john@acme.com,https://linkedin.com/in/johnsmith
Jane Doe,Beta Inc,CEO,jane@beta.com,https://linkedin.com/in/janedoe
Bob Wilson,Gamma Ltd,CTO,bob@gamma.com,https://linkedin.com/in/bobwilson
```

**Steps:**
1. Click "Import CSV" button
2. Upload test CSV file
3. Review preview (should show 3 rows)
4. Keep default settings
5. Click "Import Prospects"
6. Verify import results

**Expected Results:**
- ✅ All 3 prospects imported successfully
- ✅ No errors or warnings
- ✅ Prospects appear in prospect list
- ✅ Stats updated (Total = 3)
- ✅ Success notification shown

**Pass Criteria:**
- Import success rate: 100%
- No errors in console
- All data fields populated correctly
- Prospects searchable and filterable

---

### Test 1.2: LinkedIn Export Format (P0 - Critical)

**Scenario:** Import actual LinkedIn exported connections CSV

**Test Data:**
```csv
First Name,Last Name,Email Address,Company,Position,Connected On
John,Smith,john@acme.com,Acme Corp,VP Marketing,01 Jan 2025
Jane,Doe,jane@beta.com,Beta Inc,CEO,15 Feb 2025
```

**Steps:**
1. Upload LinkedIn export CSV
2. Verify column mapping detects "First Name" + "Last Name" → "Name"
3. Verify "Position" maps to "Job Title"
4. Import prospects

**Expected Results:**
- ✅ Automatic name combination (First + Last)
- ✅ Correct column mapping
- ✅ All prospects imported
- ✅ No data loss

---

### Test 1.3: CSV with Errors (P1 - High)

**Scenario:** Import CSV with malformed data

**Test Data:**
```csv
Name,Company,Email,LinkedIn URL
John Smith,Acme Corp,invalid-email,not-a-linkedin-url
,Beta Inc,jane@beta.com,https://linkedin.com/in/janedoe
Bob Wilson,,,https://linkedin.com/in/bobwilson
```

**Steps:**
1. Upload CSV with errors
2. Review error report in preview
3. Attempt import

**Expected Results:**
- ✅ Row 2: Error - missing name
- ✅ Row 1: Warning - invalid email (but still imports)
- ✅ Row 1: Error - invalid LinkedIn URL
- ✅ Row 3: Success - imports despite missing optional fields
- ✅ Detailed error messages shown

---

### Test 1.4: Duplicate Detection During Import (P0 - Critical)

**Scenario:** Import CSV containing duplicates of existing prospects

**Test Setup:**
1. Manually add "John Smith" prospect first
2. Then import CSV containing "John Smith" again

**Steps:**
1. Add John Smith manually
2. Import CSV with John Smith
3. Verify duplicate detected

**Expected Results:**
- ✅ Duplicate detected by LinkedIn URL
- ✅ John Smith skipped during import
- ✅ Import results show: 1 duplicate, 1 skipped
- ✅ Only one John Smith in final list

---

### Test 1.5: Large CSV Import (P1 - High)

**Scenario:** Import CSV with 100+ prospects

**Test Data:** Generate CSV with 100 rows

**Steps:**
1. Upload 100-row CSV
2. Monitor import performance
3. Verify results

**Expected Results:**
- ✅ Import completes within 10 seconds
- ✅ No browser freeze
- ✅ All 100 prospects imported
- ✅ Stats update correctly
- ✅ No memory issues

**Performance Benchmarks:**
- Import speed: < 100ms per prospect
- Memory usage: < 50MB increase
- UI responsiveness maintained

---

### Test 1.6: CSV with Special Characters (P1 - High)

**Scenario:** Import CSV with quotes, commas in data

**Test Data:**
```csv
Name,Company,Notes
"Smith, John",Acme Corp,"Interested in ""premium"" package"
Jane Doe,"Beta, Inc.","VP of Sales, Marketing"
```

**Steps:**
1. Upload CSV with special characters
2. Verify correct parsing

**Expected Results:**
- ✅ Commas in data handled correctly
- ✅ Quotes in data preserved
- ✅ No data corruption
- ✅ Names and companies display correctly

---

### Test 1.7: Empty CSV (P2 - Medium)

**Scenario:** Upload empty or header-only CSV

**Steps:**
1. Upload CSV with only headers
2. Verify error handling

**Expected Results:**
- ✅ Error message: "CSV must have at least one data row"
- ✅ Import gracefully cancelled
- ✅ No empty prospects created

---

### Test 1.8: Invalid File Type (P2 - Medium)

**Scenario:** Attempt to upload non-CSV file

**Steps:**
1. Try to upload .xlsx, .txt, .pdf file

**Expected Results:**
- ✅ File picker only shows .csv files
- ✅ Error if non-CSV uploaded
- ✅ Clear error message

---

## TEST PLAN 2: DUPLICATE DETECTION

### Test 2.1: Duplicate by LinkedIn URL (P0 - Critical)

**Scenario:** Add prospect with same LinkedIn URL

**Steps:**
1. Add prospect: John Smith, linkedin.com/in/johnsmith
2. Try to add another prospect with same URL
3. Verify duplicate warning

**Expected Results:**
- ✅ Duplicate detected
- ✅ Warning dialog shows existing prospect details
- ✅ User can choose to add anyway or cancel
- ✅ If cancelled, no duplicate created

---

### Test 2.2: Duplicate by Email (P0 - Critical)

**Scenario:** Add prospect with same email

**Steps:**
1. Add prospect with email john@acme.com
2. Try to add different person with same email

**Expected Results:**
- ✅ Duplicate detected by email
- ✅ Warning shown
- ✅ User can override if needed

---

### Test 2.3: Duplicate by Name + Company (P1 - High)

**Scenario:** Add same person at same company

**Steps:**
1. Add "John Smith" at "Acme Corp"
2. Try to add "John Smith" at "Acme Corp" again

**Expected Results:**
- ✅ Duplicate detected
- ✅ Warning shown
- ✅ Works even without LinkedIn URL or email

---

### Test 2.4: False Positive Prevention (P1 - High)

**Scenario:** Add legitimately different prospects with similar data

**Test Cases:**
- John Smith at Acme Corp
- John Smith at Beta Inc (different company)
- Jane Smith at Acme Corp (different person)

**Expected Results:**
- ✅ No false positive warnings
- ✅ All three added successfully
- ✅ Duplicate detection only triggers for actual duplicates

---

### Test 2.5: URL Normalization (P1 - High)

**Scenario:** Test URL variations detection

**Test Cases:**
- https://linkedin.com/in/johnsmith
- http://www.linkedin.com/in/johnsmith/
- linkedin.com/in/johnsmith?trk=123

**Expected Results:**
- ✅ All variations detected as same person
- ✅ URL normalization works (remove protocol, www, trailing slash, query params)
- ✅ Duplicate warning shown

---

### Test 2.6: Case Sensitivity (P1 - High)

**Scenario:** Test case-insensitive duplicate detection

**Steps:**
1. Add john@acme.com
2. Try to add JOHN@ACME.COM

**Expected Results:**
- ✅ Duplicate detected (case-insensitive)
- ✅ Email comparison is case-insensitive
- ✅ Name comparison is case-insensitive

---

## TEST PLAN 3: BROWSER NOTIFICATIONS

### Test 3.1: Permission Request (P0 - Critical)

**Scenario:** Test notification permission flow

**Steps:**
1. Open tool in fresh browser (no permissions set)
2. Verify permission request appears
3. Grant permission
4. Reload page

**Expected Results:**
- ✅ Permission request shown on first load
- ✅ User can grant or deny
- ✅ Permission persists across reloads
- ✅ No repeated permission requests if already granted

---

### Test 3.2: Follow-up Reminder Notification (P0 - Critical)

**Scenario:** Test daily follow-up reminders

**Test Setup:**
1. Add prospect with follow-up date = today
2. Wait for 9 AM or trigger manually

**Steps:**
1. Set system time to 9:00 AM
2. Verify notification appears

**Expected Results:**
- ✅ Notification shows at 9 AM
- ✅ Title: "1 Follow-up Due Today"
- ✅ Body shows prospect name
- ✅ Notification auto-closes after 10 seconds
- ✅ Clicking notification opens tool

---

### Test 3.3: Multiple Follow-ups (P1 - High)

**Scenario:** Multiple prospects due same day

**Test Setup:**
1. Add 5 prospects with follow-up date = today

**Expected Results:**
- ✅ Notification shows: "5 Follow-ups Due Today"
- ✅ First 3 prospects listed
- ✅ "...and 2 more" shown
- ✅ All 5 accessible from notification

---

### Test 3.4: No Follow-ups Due (P1 - High)

**Scenario:** No prospects need follow-up today

**Expected Results:**
- ✅ No notification shown
- ✅ No console errors
- ✅ Check runs silently

---

### Test 3.5: Prospect Added Notification (P2 - Medium)

**Scenario:** Success notification when adding prospect

**Steps:**
1. Add new prospect
2. Save

**Expected Results:**
- ✅ Notification appears: "Prospect Added"
- ✅ Shows prospect name
- ✅ Auto-closes after 10 seconds

---

### Test 3.6: Notifications Disabled (P1 - High)

**Scenario:** User denied notification permission

**Expected Results:**
- ✅ Tool works normally without notifications
- ✅ No console errors
- ✅ No notification-related crashes
- ✅ Graceful degradation

---

### Test 3.7: Browser Without Notification Support (P2 - Medium)

**Scenario:** Test in browser without Notification API

**Expected Results:**
- ✅ Feature detection works
- ✅ No errors thrown
- ✅ Tool functions normally
- ✅ Console warning logged (not error)

---

## TEST PLAN 4: ENHANCED VALIDATION

### Test 4.1: LinkedIn URL Validation (P0 - Critical)

**Test Cases:**
```
✅ Valid:
- https://linkedin.com/in/johnsmith
- http://www.linkedin.com/in/jane-doe-123/
- linkedin.com/in/bob-wilson

❌ Invalid:
- https://facebook.com/johnsmith
- linkedin.com/company/acme
- not-a-url
- (empty string)
```

**Expected Results:**
- ✅ Valid URLs accepted
- ✅ Invalid URLs rejected with clear error message
- ✅ Error shown before save attempt
- ✅ LinkedIn username extracted correctly

---

### Test 4.2: Email Validation (P0 - Critical)

**Test Cases:**
```
✅ Valid:
- john@acme.com
- jane.doe@beta.co.uk
- bob+test@gamma-corp.com

❌ Invalid:
- john@
- @acme.com
- john.acme.com
- john @acme.com
```

**Expected Results:**
- ✅ Valid emails accepted
- ✅ Invalid emails rejected
- ✅ Clear error message
- ✅ Email is optional (can be blank)

---

### Test 4.3: Phone Number Validation (P1 - High)

**Test Cases:**
```
✅ Valid (should pass):
- +1 (555) 123-4567
- 555-123-4567
- 5551234567
- +44 20 1234 5678

⚠️ Warning (should warn but allow):
- 123 (too short)
- abc-def-ghij (non-numeric)

✅ Valid (blank):
- (empty string - optional field)
```

**Expected Results:**
- ✅ Valid phones accepted
- ✅ Invalid phones show warning (not error)
- ✅ User can proceed despite warning
- ✅ Phone is optional

---

### Test 4.4: Required Fields (P0 - Critical)

**Test Cases:**
- LinkedIn URL: Required
- Name: Required
- All others: Optional

**Steps:**
1. Try to save without LinkedIn URL
2. Try to save without Name
3. Try to save without optional fields

**Expected Results:**
- ✅ Error if LinkedIn URL missing
- ✅ Error if Name missing
- ✅ Success if only required fields filled
- ✅ Clear error messages

---

### Test 4.5: Field Length Limits (P1 - High)

**Test Cases:**
- Name: 1 char (too short), 2 chars (OK), 100 chars (OK), 101 chars (too long)
- Job Title: 201 chars (warning)
- Company: 201 chars (warning)
- Notes: 5001 chars (warning)

**Expected Results:**
- ✅ Name minimum 2 characters enforced
- ✅ Long fields show warnings
- ✅ User can proceed with warnings
- ✅ Data not truncated silently

---

### Test 4.6: Validation Error Messages (P1 - High)

**Scenario:** Verify error messages are clear and helpful

**Steps:**
1. Trigger each validation error
2. Review error message quality

**Expected Results:**
- ✅ Error messages are specific
- ✅ Error messages suggest fix
- ✅ Multiple errors listed together
- ✅ Warnings separated from errors

---

### Test 4.7: Special Characters in Fields (P2 - Medium)

**Test Cases:**
- Name with apostrophe: O'Brien
- Company with &: AT&T
- Notes with quotes: He said "yes"

**Expected Results:**
- ✅ Special characters preserved
- ✅ No HTML injection
- ✅ No script injection
- ✅ Display correctly in UI

---

## TEST PLAN 5: INTEGRATION TESTS

### Test 5.1: CSV Import + Duplicate Detection (P0 - Critical)

**Scenario:** Import CSV with mix of new and duplicate prospects

**Steps:**
1. Manually add 3 prospects
2. Import CSV with 5 prospects (3 duplicates, 2 new)
3. Verify results

**Expected Results:**
- ✅ 2 new prospects imported
- ✅ 3 duplicates skipped
- ✅ Import results accurate
- ✅ Total prospects = 5 (not 8)

---

### Test 5.2: Validation + Notifications (P1 - High)

**Scenario:** Add prospect with validation warnings, get notification

**Steps:**
1. Add prospect with warning-level issues
2. Confirm despite warnings
3. Verify notification

**Expected Results:**
- ✅ Warnings shown before save
- ✅ User can proceed
- ✅ Success notification appears
- ✅ Prospect saved correctly

---

### Test 5.3: Import + Notifications (P1 - High)

**Scenario:** Import CSV, get success notification

**Steps:**
1. Import CSV with 10 prospects
2. Verify notification

**Expected Results:**
- ✅ Import completes
- ✅ Notification shows "10 prospects imported"
- ✅ Stats update correctly

---

### Test 5.4: Full Workflow Test (P0 - Critical)

**Scenario:** Complete user journey

**Steps:**
1. Open tool (first time)
2. Grant notification permission
3. Import CSV (10 prospects)
4. Manually add 1 prospect (triggers duplicate warning)
5. Override duplicate warning
6. Set follow-up dates for 3 prospects
7. Export to CSV
8. Verify export matches import + manual addition

**Expected Results:**
- ✅ Permission granted successfully
- ✅ CSV import successful
- ✅ Duplicate detected and handled
- ✅ Follow-up dates saved
- ✅ Export includes all prospects
- ✅ Data integrity maintained

---

## TEST PLAN 6: ERROR HANDLING

### Test 6.1: Network Offline (P1 - High)

**Scenario:** Use tool while offline

**Steps:**
1. Disconnect internet
2. Use tool (add, edit, delete prospects)
3. Reconnect

**Expected Results:**
- ✅ Tool works offline (localStorage)
- ✅ No network errors
- ✅ Changes persist
- ✅ Graceful handling of any network features

---

### Test 6.2: localStorage Full (P2 - Medium)

**Scenario:** Test behavior when storage quota exceeded

**Steps:**
1. Add thousands of prospects until storage full
2. Verify error handling

**Expected Results:**
- ✅ Clear error message
- ✅ No data corruption
- ✅ Suggests export or cleanup

---

### Test 6.3: Corrupted Data in localStorage (P1 - High)

**Scenario:** Handle corrupted saved data

**Steps:**
1. Manually corrupt localStorage data
2. Reload tool

**Expected Results:**
- ✅ Error caught gracefully
- ✅ Falls back to empty state
- ✅ Console error logged
- ✅ User notified of data loss

---

### Test 6.4: Browser Compatibility (P0 - Critical)

**Browsers to Test:**
- Chrome (latest)
- Firefox (latest)
- Safari (latest)
- Edge (latest)

**Expected Results:**
- ✅ Works in all major browsers
- ✅ Feature detection for unsupported features
- ✅ Graceful degradation where needed
- ✅ No console errors

---

## TEST PLAN 7: PERFORMANCE & LOAD

### Test 7.1: 1,000 Prospects Load (P1 - High)

**Scenario:** Performance with large dataset

**Steps:**
1. Import CSV with 1,000 prospects
2. Measure load time and responsiveness

**Expected Results:**
- ✅ Initial load < 3 seconds
- ✅ Search/filter < 500ms
- ✅ Render time < 2 seconds
- ✅ No UI freezing

---

### Test 7.2: Memory Leak Test (P1 - High)

**Scenario:** Check for memory leaks

**Steps:**
1. Add 100 prospects
2. Filter/search repeatedly
3. Add/edit/delete repeatedly
4. Monitor memory usage

**Expected Results:**
- ✅ Memory usage stable
- ✅ No gradual increase
- ✅ Garbage collection working

---

### Test 7.3: Concurrent Operations (P2 - Medium)

**Scenario:** Multiple operations simultaneously

**Steps:**
1. Start CSV import
2. Add manual prospect during import
3. Filter prospects during import

**Expected Results:**
- ✅ All operations complete successfully
- ✅ No race conditions
- ✅ Data integrity maintained

---

## TEST PLAN 8: SECURITY

### Test 8.1: XSS Prevention (P0 - Critical)

**Scenario:** Attempt to inject scripts

**Test Cases:**
- Name: `<script>alert('XSS')</script>`
- Company: `<img src=x onerror=alert('XSS')>`
- Notes: `<a href="javascript:alert('XSS')">Click</a>`

**Expected Results:**
- ✅ Scripts do not execute
- ✅ HTML escaped properly
- ✅ Display as plain text
- ✅ No security warnings in browser

---

### Test 8.2: CSV Injection Prevention (P1 - High)

**Scenario:** Prevent formula injection in CSV export

**Test Cases:**
- Name: `=SUM(1+1)`
- Notes: `=cmd|'/c calc'!A1`

**Expected Results:**
- ✅ Formulas quoted/escaped in CSV
- ✅ No execution when opened in Excel
- ✅ Safe export

---

### Test 8.3: Data Sanitization (P1 - High)

**Scenario:** Ensure user input is sanitized

**Steps:**
1. Add prospect with various special characters
2. Verify proper escaping everywhere displayed

**Expected Results:**
- ✅ All user input escaped
- ✅ No HTML injection possible
- ✅ Safe rendering in all contexts

---

## TEST PLAN 9: USABILITY

### Test 9.1: First-Time User Experience (P0 - Critical)

**Scenario:** New user opens tool for first time

**Steps:**
1. Open tool with no data
2. Navigate UI
3. Add first prospect

**Expected Results:**
- ✅ Empty state is clear
- ✅ Call-to-action obvious
- ✅ Import and Add buttons prominent
- ✅ First prospect added successfully

---

### Test 9.2: Error Message Clarity (P1 - High)

**Scenario:** Review all error messages

**Test Cases:**
- Trigger each validation error
- Cause each import error
- Review message quality

**Expected Results:**
- ✅ Messages in plain English
- ✅ Suggest corrective action
- ✅ No technical jargon
- ✅ Helpful tone

---

### Test 9.3: Mobile Responsiveness (P1 - High)

**Devices to Test:**
- iPhone (Safari)
- Android (Chrome)
- iPad (Safari)

**Expected Results:**
- ✅ Layouts adjust properly
- ✅ Buttons large enough to tap
- ✅ Modals work on mobile
- ✅ CSV import works on mobile

---

## TESTING CHECKLIST

### Pre-Testing Setup
- [ ] Create test CSV files (valid, invalid, large, special chars)
- [ ] Create test prospects dataset
- [ ] Set up fresh browser profiles for testing
- [ ] Prepare test devices (desktop, mobile, tablet)

### Testing Execution
- [ ] Run all P0 (Critical) tests first
- [ ] Document all failures with screenshots
- [ ] Run all P1 (High) tests
- [ ] Run all P2 (Medium) tests
- [ ] Run all P3 (Low) tests if time permits

### Bug Tracking
- [ ] Log each bug with severity
- [ ] Include steps to reproduce
- [ ] Attach screenshots/videos
- [ ] Verify fix before closing

### Sign-Off Criteria
- [ ] 100% of P0 tests pass
- [ ] 95%+ of P1 tests pass
- [ ] 80%+ of P2 tests pass
- [ ] No critical security issues
- [ ] No data loss scenarios
- [ ] Performance benchmarks met

---

## TEST RESULTS TEMPLATE

### Test Result: [Test ID]
**Date:** [Date]
**Tester:** [Name]
**Browser:** [Browser + Version]
**Status:** ✅ PASS / ❌ FAIL / ⚠️ PARTIAL

**Steps Executed:**
1. [Step 1]
2. [Step 2]
3. [Step 3]

**Actual Results:**
[What actually happened]

**Expected Results:**
[What should have happened]

**Deviations:**
[Any differences from expected]

**Screenshots:**
[Attach if applicable]

**Notes:**
[Additional observations]

---

## REGRESSION TESTING

After any bug fixes, re-run:
1. All failed tests
2. Related functionality tests
3. Integration tests involving changed code

---

## PERFORMANCE BENCHMARKS

| Metric | Target | Measured | Pass/Fail |
|--------|--------|----------|-----------|
| CSV Import (100 rows) | < 2s | | |
| Initial Page Load | < 2s | | |
| Search Response | < 300ms | | |
| Filter Response | < 200ms | | |
| Add Prospect | < 500ms | | |
| Notification Show | < 100ms | | |

---

## COMMERCIAL-GRADE CRITERIA

To pass Phase 1 and move to Phase 2:

### Functionality
- [ ] All P0 tests pass (100%)
- [ ] All P1 tests pass (95%+)
- [ ] No data loss scenarios
- [ ] No crashes or freezes

### Security
- [ ] XSS prevention verified
- [ ] CSV injection prevented
- [ ] Data sanitization working
- [ ] No security vulnerabilities

### Performance
- [ ] All benchmarks met
- [ ] No memory leaks
- [ ] Handles 1000+ prospects
- [ ] Mobile performance acceptable

### Usability
- [ ] Intuitive for first-time users
- [ ] Clear error messages
- [ ] Mobile responsive
- [ ] Accessible (basic WCAG compliance)

### Reliability
- [ ] Works offline
- [ ] Handles errors gracefully
- [ ] Cross-browser compatible
- [ ] Data integrity maintained

---

## PHASE 1 SIGN-OFF

**Testing Completed:** [Date]
**Tested By:** [Name(s)]
**Sign-Off:** [Name]
**Status:** APPROVED FOR PHASE 2 / NEEDS FIXES

**Summary:**
[Overall test results summary]

**Critical Issues:**
[List any blocking issues]

**Recommendations:**
[Suggestions for improvement]

---

**Next Steps After Phase 1 Approval:**
1. ✅ Move to Phase 2 implementation
2. ✅ Begin backend database architecture
3. ✅ Implement multi-user support
4. ✅ Add team collaboration features

---

**Document Version:** 1.0
**Last Updated:** February 10, 2026
**Next Review:** After Phase 1 testing complete
