# SEO audit regression test

Runs the real `web/js/seo-audit.js` in a headless browser against a fixture
site, and asserts on the findings it produces.

```bash
PLAYWRIGHT_PATH=/opt/node22/lib/node_modules/playwright node tests/seo-audit/run.js
# or, if playwright resolves normally:
node tests/seo-audit/run.js
```

## Why this exists

An audit run against a real customer site came back almost entirely false
positives: missing/short titles on pages with hand-written titles, missing
`rel="noopener"` on links that carried `rel="noreferrer"`, render-blocking
scripts on pages whose scripts were all async, duplicate titles and missing
H1s for a single page reached through three URLs, and thin-content warnings
on a changelog. The report looked plausible and described almost nothing
real, which is worse than no report at all.

The fixture site reproduces that exact shape:

- hand-written titles including a 28-character one (`Terms of Service |
  Webese.ai`) that the old `< 30` rule called "too short"
- an inline theme-flash guard, an inline GTM snippet that sets `async` in JS,
  and an async analytics tag — the old check counted all three as
  render-blocking
- external links carrying `rel="noreferrer"` (a superset of `noopener`)
- `/build` and `/dashboard` disallowed in `robots.txt` and redirecting to
  `/login` — one real page reachable three ways
- a `/changelog` that is short because changelogs are short

## The control page

`/genuinely-broken` has real problems: three render-blocking external head
scripts, a `target="_blank"` link with no `rel`, no H1, no meta description,
and a 3-character title.

Half the assertions check that the false positives are gone. The other half
check that this page **still gets flagged**. Both halves matter — a checker
that reports nothing is as useless as one that reports everything, and
"fixed the false positives" must not quietly mean "turned the checks off".
