# Sales intelligence tests

```
node tests/sales-intelligence/run.js
```

63 assertions over the ten enrichment endpoints, their client call sites, and
`web/agents/sales-agent.html`.

## What the audit found

The scoring that is actually used is honest. `calcPriorityScore` in
`lead-generation.html` reads real fields — title seniority against a regex,
count of detected signals, whether email verification came back `deliverable`,
whether a LinkedIn profile exists — and weights them. Email discovery
explicitly refuses to guess an address, and Apollo results are never
backfilled with a plausible-looking value. Those were already right.

**Every enrichment endpoint spent money for an unidentified caller.**
`apollo-enrich`, `lead-enrich`, `lead-signals`, `enrich-business`,
`profile-search`, `hunter`, `outreach-draft`, `domain-metrics`, `scout-data`
and `seo-backlink-prospects` all call Apollo, Hunter.io, Perplexity, Claude or
DataForSEO on the account's own keys, and none checked who was calling. That
is not primarily a data leak — it is a direct line into the owner's billing.
Anyone with the URL could run lookups indefinitely at the account's expense,
or use the deployment as a free proxy to those services.

A rate limit is not a substitute: it caps how fast the money goes, not whether
the caller was ever entitled to spend it. `api/_lib/require-user.js` is the
one gate, and it **fails closed** — if Supabase cannot be reached the request
is refused, because being unable to verify a caller is not the same as
verifying them.

**An unscored prospect was shown a score.** `p.opportunityScore || 5` put a
5/10 into a coloured ring for every prospect Claude had not scored, and turned
a real `0` into a `5`. The detail view already showed an em dash for the same
field, so the card was the only place claiming a score that did not exist.

The filter was worse: `p.opportunityScore < scoreFilter`, and `undefined < 7`
is `false`, so filtering to "8 and above" listed prospects nobody had assessed
at all. Sorting on `undefined` produced `NaN` comparisons, which order
unpredictably.

All three now go through `isScored()`. A missing score renders a dash in a
neutral ring, is excluded whenever a minimum is set, and sorts last.

## Harness notes

- Every paid API key is set in the test environment, so a refusal can only
  come from the auth gate and never from a missing-configuration branch — a
  test that passed because `APOLLO_API_KEY` was absent would prove nothing.
- The fetch stub records **any** non-auth URL as an upstream call. Reaching a
  third party at all, in a test where the caller was not authenticated, is the
  failure being guarded against, so the assertion is "no upstream call
  happened" rather than "the response looked wrong".
- Source-reading assertions strip comment lines first: the fixes quote the
  expressions they removed, and matching those would turn an assertion about
  shipped code into one about prose.

## Still open elsewhere

The same pattern exists on eleven endpoints outside this audit's scope, and
they are listed in the commit message. Two are worth singling out:
`api/claude.js`, `api/openai.js` and `api/perplexity.js` are unauthenticated
LLM proxies — free inference on the account's keys for anyone who finds them —
and `api/integration.js` is an unauthenticated proxy to Ahrefs, Semrush and
DataForSEO. `api/generate-ad-image.js` meters credits against an
`intelProfileId` taken from the request body, so the metering can be pointed
at another account's balance or omitted entirely.
