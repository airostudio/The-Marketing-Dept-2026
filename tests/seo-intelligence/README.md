# SEO intelligence tests

```
PLAYWRIGHT_PATH=/opt/node22/lib/node_modules/playwright node tests/seo-intelligence/run.js
```

46 assertions over `web/js/keyword-service.js`, `web/seo-pulse.html`,
`web/seo/keywords.html`, `web/seo/backlinks.html` and the SEO Pulse → tool
handoff.

## The two bugs worth understanding

Both were invisible because JavaScript made them look reasonable.

**`null <= 3` is true.** A tracked keyword carries `position === null` until a
ranking provider reports one. Every count in `getStats()` was written as
`k.position <= 3`, so a keyword nobody had ever looked up was counted as
ranking in the top 3 — and the top 10, and the top 20, all at once. Add twenty
keywords to a fresh account and the dashboard reported twenty top-3 rankings.
The same coercion credited unranked keywords with a tenth-place click-through
rate in the traffic estimate, and `sum + null` treated them as position 0 in
the average, which made the average *better* than the truth.

Everything now goes through one `isRanked()` guard, and unranked keywords are
reported as their own number rather than folded into a win.

**A failed PageSpeed call scored 15/100.** `seo-pulse.html` called
googleapis.com straight from the browser using `APP_CONFIG.GOOGLE.API_KEY`,
which is deliberately empty — the key belongs in a server env var. So requests
went out unauthenticated, Google rate-limited them, and the `catch` only
logged. Performance, SEO and accessibility stayed at 0 while security stayed
at 100, and `0*0.3 + 0*0.35 + 0*0.2 + 100*0.15` is exactly 15. The page then
showed "15/100" with an empty issue list: the worst verdict the tool can give,
with nothing behind it, next to progress text reading "Meta tags analyzed".

It now goes through `/api/pagespeed` like every other SEO tool, and a failed
scan shows no score at all — just what failed and why.

## The third bug: the provider was reachable all along

`api/integration.js` is a working server-side proxy for Ahrefs, Semrush and
DataForSEO, holding the credentials in environment variables — the only
correct place for them. But every client-side `isAvailable()` decided whether
a provider was usable by looking for those same credentials in `window`
config, where they must never appear. So in a correctly configured deployment
the check was always false, the working proxy was never called, and the UI
reported "no ranking provider connected" on an account that was paying for
one.

Underneath that sat a second fault it was hiding. There are two DataForSEO
objects on `ApiConnector` and they are not the same shape:
`SEOTools.dataforseo` exposes `isAvailable`/`getSerpResults`/`getKeywordData`,
while `getRankings` and `getKeywordMetrics` live on the top-level
`ApiConnector.DataForSEO`. Three call sites in `keyword-service.js` asked
`SEOTools.dataforseo` for `getRankings`/`getKeywordMetrics`, which would have
thrown "not a function" — but `isAvailable()` was false, so execution never
reached the broken call. Fixing either bug alone would have surfaced the
other.

`/api/integration` now answers a `GET` capability probe with booleans (never
values), the connector caches it and `isAvailable()` reads the cache while
staying synchronous, and both call paths resolve the module that actually has
the method.

## Harness note

`KeywordTracker` persists to `localStorage`, which throws a `SecurityError` on
`about:blank` (an opaque origin has no storage). The suite serves a minimal
`/harness.html` from its own server and loads the service into that, so the
service is exercised against real storage on a real origin.

## What is checked structurally

Three assertions read source rather than behaviour, because they guard against
a regression appearing in a file the browser tests do not open:

- no bare `k.position <= N` comparison outside the `isRanked` guard,
- every "Fix Now" target page exists *and* loads `seo-pulse-handler.js`
  (`mobile.html` did not, so viewport fixes landed on a page that ignored
  them), and every action the pulse sends has a handler entry,
- no page falls back to `'example.com'` when the customer has no site
  configured — `backlinks.html` and `keywords.html` both used to scan a domain
  the customer does not own and report the result as theirs.

The word-count check strips comment lines first: the fix's own explanation
quotes the old `90 - (words * 15)` formula, and matching that would make the
assertion pass or fail on prose.
