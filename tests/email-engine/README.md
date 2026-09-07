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

## Still not measured, deliberately

Per-campaign **revenue** is left blank. Attributing revenue to a send needs
order data linked back to it, and nothing in this app records that. The column
shows an em dash with a tooltip saying why, rather than a number.
