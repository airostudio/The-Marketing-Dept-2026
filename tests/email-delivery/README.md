# Email Delivery & Audience Manager tests

```
node tests/email-delivery/run.js
```

40 assertions over `api/send-campaign.js`, `api/send-email.js`,
`api/unsubscribe.js`, `api/_lib/send-guard.js` and `web/js/contacts-store.js`.

## What the audit found

The parts that draft and review a campaign were sound: contacts, segments,
Scotty's QA gate (a real Claude call with a strict rubric, enforced before
send with an explicit, labelled override), batching, compliance footers. Every
problem was in the code that actually sends.

**The send endpoints were an open relay.** `send-campaign.js` and
`send-email.js` had no authentication and `Access-Control-Allow-Origin: *`.
Anyone who could reach the URL could send arbitrary content to arbitrary
addresses through the account's Resend key, from its verified sending domain —
the single most valuable asset a phisher can borrow. The only guards were an
IP rate limit and a global daily counter.

**Suppression was never enforced server-side.** Neither endpoint checked
whether a recipient had opted out; both took the recipient list on trust. The
only gate was client-side `resolveSegmentContacts`, whose static branch always
filtered to subscribed but whose dynamic branch used
`rules.status || SENDABLE` — so a segment saved with `status: 'unsubscribed'`
returned opted-out people and handed them straight to the sender. The current
UI hardcodes `'subscribed'`, which is why the asymmetry was invisible, but
`createSegment` accepts any rules and an owner can edit their own segment row
under RLS.

**Unsubscribe promised what it could not keep.** It was keyed on `contact_id`,
so a recipient pasted into an ad-hoc send had nothing to update: clicking the
link recorded nothing at all while the confirmation page said they would not
be emailed again. The next send to the same pasted list mailed them.

**The daily limit was global and in-memory.** `dailySendCount` was a
module-level variable shared by every customer on the deployment and reset on
every cold start — so one account's sending consumed everyone's budget, while
each serverless instance kept its own tally and the real ceiling was whatever
the instance count happened to be. Too strict and too loose at once.

## The shape of the fix

`email_suppressions` is keyed on the **address**, not the contact, so the
promise holds for people who were never in the CRM. A trigger keeps it in step
with `contacts.status`, and the migration backfills everyone already opted
out — otherwise suppression would only start working from each person's *next*
status change.

`filterSuppressed()` runs in `api/_lib/send-guard.js`, in the one code path
that reaches Resend, because that is the only place a check cannot be gone
around. It **fails closed**: if the list cannot be read, nothing is sent. Not
being able to tell who opted out is not permission to email everyone. A
missing table is reported distinctly, so an operator sees a setup problem
rather than a silent halt.

Quota is claimed *before* sending and released if the send does not happen —
otherwise two concurrent sends both see the same remaining budget and both
spend it, and a provider outage silently eats the day's allowance.

## Harness note

The endpoints rate-limit per IP (3 campaign sends a minute), which is correct
behaviour but throttles a test suite firing dozens of calls from one address —
turning every later assertion into a 429 that looks exactly like a broken
endpoint. Each call is given a distinct `x-forwarded-for`, as real callers
would have. Source-reading assertions strip comment lines first, since the
fixes explain themselves by quoting the expressions they removed.

## Still true after this pass

`resolveSegmentContacts` still filters client-side. That is deliberate
duplication, not redundancy: the client filter keeps the counts and previews
in the UI honest, and the server filter is the one that cannot be bypassed.

`upsertContacts` omits `status` from its payload, so re-importing a CSV
containing someone who unsubscribed does not resurrect them. It also does not
warn that some of the imported rows are suppressed — the count reported is
"imported", not "mailable".
