# SEO Project Creation → Audit Pipeline — Fake Data Audit & Fixes

**Date:** 2026-07-30
**Scope:** The "Create a project to start tracking your website's SEO performance"
flow — from URL entry in the project wizard through to the SEO report shown on
the dashboard. Not the same code path as `SEO_INTELLIGENCE_AUDIT.md` (which
covers the standalone chat-style `seo-agent.html` page) or
`SEO_COMPETITORS_DEMO_DATA_WARNING.md` (which covers the static
`seo/competitors.html` page) — neither of those documented this issue.

## Root cause

`web/js/seo-audit.js` is the real crawler behind project-creation audits
(`project-wizard.js` → `analyzing.html` → `analysis-engine.js` →
`window.SEOAudit`). Its `fetchPage()` function tried, in order:

1. A direct `fetch()` from the browser — fails for almost every cross-origin
   site (no CORS headers), by design of the web platform.
2. Two third-party CORS proxies (`api.allorigins.win`, `corsproxy.io`) —
   frequently rate-limited or down.
3. **If both failed: `generateSimulatedHtml()`** — a hardcoded canned HTML
   stub (empty `<title>`, one `<img>`, one link) with **no relationship to
   the real site**, logged only as a `console.warn`.

Because step 3 always succeeded, the crawl never failed outright — it
silently produced the same generic, site-independent issue set ("Missing
title tag", "Missing meta description", etc.) for any site whose real content
couldn't be reached, with nothing in the UI indicating the report wasn't
real. This is exactly what was reported: a report that *looks* like it ran,
but describes a fake page instead of the actual website.

The same reliability problem — without the fake-data fallback — also existed
in `checkRobotsTxt()`, `checkSitemap()`, and `checkLinkStatus()` (broken-link
verification), all of which depended solely on the same flaky proxies and
would report false "could not verify" issues whenever the proxies were down.

## Fixes

1. **New `api/fetch-page.js`** — a server-side fetch endpoint. Server-to-server
   requests have no CORS restriction, so this reliably fetches almost any
   public site directly, without depending on third-party proxies at all.
   Includes an SSRF guard (blocks localhost/private IP ranges and the cloud
   metadata address) since it accepts an arbitrary caller-supplied URL.

2. **`seo-audit.js` `fetchPage()`**: now tries direct fetch → `/api/fetch-page`
   → third-party proxies (last-resort fallback) → **returns `null`** if all
   three fail. `generateSimulatedHtml()` has been removed entirely — a page
   that can't be fetched is never faked.

3. **`seo-audit.js` `crawlPages()`**: if *every* page fails to fetch (the
   whole site is unreachable), the crawl now throws a clear error —
   `"Could not fetch any pages from <url>..."` — instead of completing
   silently with zero real data. This propagates through `startAudit()` /
   the `SEOAudit` constructor's `onError` and surfaces as a visible failure
   in `analyzing.html` ("Analysis failed — please verify the URL and try
   again"), rather than a misleadingly "complete" report.

4. **`checkRobotsTxt()`, `checkSitemap()`, `checkLinkStatus()`**: now use the
   same reliable server-side path first (`/api/fetch-page` for
   robots.txt/sitemap.xml, `/api/check-url` for link status checks), with the
   third-party proxies kept only as a last-resort fallback. This removes most
   of the false "could not verify" issues that were really just proxy
   downtime, not real site problems.

5. **`web/js/analysis-engine.js` `performSimpleCrawl()`** (the fallback path
   used only if `window.SEOAudit` somehow isn't loaded): upgraded to try
   `/api/fetch-page` before the single third-party proxy it depended on
   exclusively before. This path already failed loudly on total failure —
   no fake-data issue here, just a reliability gap, now closed.

6. **`api/check-url.js`**: rate limit raised from 10/min to 80/min per IP —
   it's now also called up to 50 times per audit for broken-link
   verification, not just once per wizard submission.

## What was already real (no fake data found)

- PageSpeed Insights scores/Core Web Vitals — real call to Google's public
  API, gracefully skipped (not faked) when it fails or no key is configured.
- Health score calculation — deterministic sum from real issue severities,
  no randomization.
- Keyword extraction — derived from real crawled page titles.
- Duplicate title/description detection, site-wide issue detection — all
  computed from real per-page crawl data.
- Backlinks — left at 0 when DataForSEO isn't configured, never fabricated.

## Verification

- All changed/new files pass `node -c` / syntax checks.
- `api/fetch-page.js` was exercised directly (not through the browser) for:
  a successful-shaped response, an upstream HTTP-error response, and the
  SSRF guard against `localhost`, `169.254.169.254`, and a private `192.168.x.x`
  address — all behaved correctly.
- End-to-end live testing against arbitrary external websites was not
  possible from this sandboxed dev environment (its network policy blocks
  general internet fetches through the dev proxy) — verify against a real
  site once deployed to Vercel.
