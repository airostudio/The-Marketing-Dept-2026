# Support ticketing tests

```
PLAYWRIGHT_PATH=/opt/node22/lib/node_modules/playwright node tests/support/run.js
```

46 assertions across `api/support-tickets.js`, `web/support.html` and
`web/admin/support.html`.

## What this is really testing

The endpoint holds the service-role key, which bypasses RLS entirely. So the
RLS policies in `supabase-support.sql` are a second line of defence, not the
first one — every assertion here is a version of the same question: does the
endpoint re-establish who the caller is, from the database, before it answers?

The three that matter most:

- **Internal notes never leave the server in a customer's response.** The
  endpoint asks PostgREST for `internal=eq.false` when the caller is not an
  admin, so a note is not in the payload to be filtered out later. The test
  asserts against the whole serialised response and, for the page, against
  `page.content()` — not against what is visible.
- **A customer cannot learn that another customer's ticket exists.** A
  forbidden ticket and a non-existent one return byte-identical 404s.
- **Nothing about identity comes from the request.** A `create` carrying
  `plan_at_open`, `author_role` and `user_id` is stored with the caller's real
  plan and id; a customer's `internal: true` on a reply is ignored.

## Two traps this harness has already fallen into

**1. `'user_id=eq.'` contains `'id=eq.'`.** The fake PostgREST matched the id
filter first and filtered the wrong column, so `list` returned `[]` — and
every assertion about the list then passed vacuously against an empty array.
The filters are anchored on the query separator (`/[?&]id=eq\./`) for that
reason. Whenever an assertion about "only the caller's own X" passes, check
it is not passing on an empty set.

**2. Stubs must be injected AFTER the real module `<script>` tags.** Both
pages load `supabase.min.js` → `config.js` → `supabase-client.js` →
`auth.js`. A stub injected before them is overwritten and the test silently
exercises the signed-out path. The harness replaces the `auth.js` tag itself,
so the stub lands last.

## One real bug this suite found

`bump_support_ticket_on_reply()` originally reopened a ticket only from
`resolved`/`closed`. A customer replying to a `pending` ticket left it in
"Awaiting the customer" — so it dropped out of support's Open queue while the
customer sat waiting for an answer. Any customer reply now sets `open`.
