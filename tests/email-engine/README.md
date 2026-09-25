# Email Engine tests

```
PLAYWRIGHT_PATH=/opt/node22/lib/node_modules/playwright node tests/email-engine/run.js
```

43 assertions over `api/resend-webhook.js`, `api/campaign-stats.js`,
`web/js/email-marketing-service.js`, `web/js/contacts-store.js` and
`web/marketing/email-marketing.html`.

## What the audit found

The send path was genuinely real — contacts, segments, the QA gate, the
batched Resend send with compliance footers and List-Unsubscribe. The problems
were all in the layer that reported on it.

**Opens and clicks were never recorded.** `api/resend-webhook.js` handled
`email.bounced` and `email.complained` and ignored everything else, and
`ApiConnector.EmailMarketing.resend` has no `getCampaignStats`. So
`campaign.stats.opens` was 0 for every campaign ever sent, and the UI rendered
"0.0% open rate" as a measured result. A client reads that as *nobody opened
my email*; the truth was that nobody counted. `api/send-campaign.js` had been
tagging every send with `campaign_id` and `contact_id` all along, so the
attribution was available — there was just nowhere to put the answer.

**The dashboard was invented.** `web/marketing/email-marketing.html` shipped
~250 lines of static markup: campaigns named "January Product Launch" with
24,530 sends and $14,820 of revenue, four automation flows with conversion
rates, segment counts of 48,320, a 98.7% delivery panel, and A/B test results.
None of it was wired to anything — `#campaignTableBody` had an id and nothing
ever wrote to it. The KPI tiles above were honest; everything below was
fiction.

**Deliverability asserted perfection from nothing.** With zero sends,
`getDeliverabilityMetrics()` returned `inboxPlacement: 100.0` and
`healthStatus: 'healthy'`. Separately, `100 − bounces − spam` is not inbox
placement in any case: a message delivered to the spam folder is accepted by
the receiving server. That field is now `acceptedRate`, which is what it
measures.

**A failed generation looked like a successful one.** `getFallbackEmail()`
returned fixed copy ("Unlock Your Exclusive Offer Inside") into the same
preview pane as a real generation, with nothing marking it as canned.

## The three states behind one "0%"

`api/campaign-stats.js` exists to separate these, because they produce the
same number and mean different things:

- `no-events` — nothing has been received for this campaign. It has not been
  sent, or the webhook is not pointed at `/api/resend-webhook`.
- `not-recorded` — delivery events arrived but no opens among them. Open and
  click tracking are enabled **per domain** in the Resend dashboard and are
  **off by default**, so this is common and is not a measurement of zero
  engagement.
- `tracked` — opens were recorded, and the rate is real.

Rates are `null` in the first two states, never `0`. A null renders as an em
dash; a zero renders as "nobody opened it".

## Harness notes

- The webhook is exercised through a **real Svix signature** — HMAC-SHA256
  over `${svix-id}.${svix-timestamp}.${raw body}` with the base64-decoded
  secret — because the handler verifies against the exact raw bytes and
  `bodyParser` is disabled. A test that bypassed the signature would not be
  testing the endpoint that runs in production.
- Resend returns tags as an **array of `{name, value}`**, not the object the
  original handler assumed; reading `tags.contact_id` off an array yields
  `undefined`. Both shapes are accepted now and both are asserted.
- A webhook retry must not inflate the open count, and must still answer 200 —
  a 500 makes Resend retry the same event indefinitely. Both are asserted.
- Assertions about removed markup strip comment lines first: the fixes explain
  themselves by quoting the figures they deleted ("the old panel printed
  98.7%"), and a plain substring search would turn an assertion about shipped
  markup into an assertion about how the comment is worded.

## Revenue

Per-campaign revenue was blank in the first pass of this audit, because
attributing an order to a send needs data this app did not record. It is now
real — see **Revenue: the rule is recorded, not assumed** below — but only for
accounts whose shop posts orders to `/api/track-conversion`. Where that is not
wired up the column still shows an em dash with the reason, never a zero.

---

# Split tests, flows and revenue

```
node tests/email-engine/engine.js
```

32 assertions over `api/ab-tests.js`, `api/email-flows.js`,
`api/cron-email-flows.js`, `api/track-conversion.js` and
`api/_lib/ab-split.js` — the three things that showed as "not set up" once
the invented markup was removed.

## A/B: why assignment is hashed, not random

A send can be retried — a batch fails halfway, an operator re-runs it, a flow
step is reprocessed after a timeout. With `Math.random()` the same person
lands in A on the first attempt and B on the second, and their open is then
counted against a variant they were never shown. `assignVariant()` hashes
`testId:email`, so a retry re-derives the assignment it already made. The
suite asserts a repeated batch of 200 produces a byte-identical arm list and
creates no duplicate rows.

Variants are sorted by label before the buckets are laid out. Without that, a
query returning B before A would silently swap who gets what between two runs
of the same send.

The summary reports a **leader**, never a winner: it is a difference between
two rates, not a significance test, and at typical list sizes a handful of
opens reverses it. A variant with no delivered mail has a `null` rate, not 0%
— an arm with no data is not an arm that converted nobody.

## Flows: claim before send

The cron moves an enrolment forward **before** sending it, using a
compare-and-set on `(status, next_step_order)`. If two runs overlap, the
second updates zero rows and skips. The ordering is deliberate: claiming
afterwards would risk sending the same step twice on a retry, and a duplicate
send cannot be taken back, whereas a missed step is visible and recoverable.

Suppression is re-checked at send time, not only at enrolment — the enrolment
may predate the recipient's unsubscribe by days. The suite asserts a contact
who unsubscribes mid-sequence is not sent the next step and is exited with the
reason recorded.

A paused flow sends nothing, and its enrolments are left intact so resuming
continues rather than restarting everyone.

`MAX_SENDS_PER_RUN` caps a single run at 200. A flow misconfigured to enrol an
entire list should cost one capped run, not the sending domain.

## Revenue: the rule is recorded, not assumed

An order is credited to the campaign the buyer most recently **clicked** before
it, within `ATTRIBUTION_WINDOW_DAYS` (7); failing that the most recent
**open**; failing that **nothing**. Last-click-in-a-window is a convention, not
a truth — somebody who clicked a newsletter then bought after seeing a
billboard is credited to the newsletter — so every row stores which rule
fired, and orders matching no campaign are kept with `attribution: 'none'` and
excluded from campaign revenue rather than spread across campaigns or dropped
so the totals look tidier.

Amounts are integer cents. `49.95` is asserted to survive as `4995`.

A repeated `externalId` is reported as a duplicate and not counted twice — an
order webhook retrying is normal.

## Setup this needs

- `supabase-email-engine.sql` (also in `supabase-install-all.sql`).
- `CRON_SECRET` — already used by the other cron jobs. The flow cron is
  registered in `vercel.json` at `*/15 * * * *`.
- `CONVERSION_API_KEY` — a separate key for the customer's shop to post orders
  with. Deliberately not a user session: the caller is a server, not a browser.
- Optional `ATTRIBUTION_WINDOW_DAYS` (default 7).
