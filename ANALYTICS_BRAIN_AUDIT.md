# Analytics Brain — Audit

**Superseded:** the previous version of this file (dated 2026-03-15) is kept in
git history. Several of its findings had already been fixed, one of its
"working well" items was wrong, and it missed the most serious problems. This
is a re-audit against the code as it stands, with every claim verified by
running it.

Covered by `tests/analytics-brain/run.js`.

---

## The module is two things, and only one was in trouble

**`web/agents/analytics-agent.html` — the Analytics Brain agent — is honest.**
The March audit's headline finding ("NO Intelligence Layer integration") was
already false: the page pulls structured business context, competitor radar and
objectives from `IntelligenceEngine`, builds real rule-based segments over the
actual `ContactsStore`, computes attribution from touchpoint sequences the user
pastes (and labels the result "real math, not an AI estimate"), and persists
reports through `AnalyticsStore`. It tells Claude not to invent demographics for
a real segment. Nothing here fabricates. It was left alone.

**`web/marketing/analytics.html` + `web/js/marketing-analytics-service.js` were
the opposite.**

---

## What was wrong

### 1. The dashboard's only data path did not exist

The page called `MarketingAnalyticsService.getDashboardData()` and
`.getAIInsights()`. **Neither method was ever defined.** Every page load threw a
`TypeError`, a `catch` logged "Service unavailable, rendering defaults", and the
page fell through to its placeholder renders. Nothing a customer saw on that
page had ever touched their account.

Worse, even the success path discarded real data: it rendered `data.kpis`, then
immediately called `renderKPIs()` again with no arguments, so the placeholders
overwrote anything real.

### 2. The Google Analytics integration could not work — three ways over

The March audit listed this under "What's Working Well". It was not working.

- It called `GoogleAnalytics.getDashboardData()`, which the connector does not
  export either.
- `getOverviewMetrics` and `getChannelBreakdown` were **synchronous** but the
  connector returns a **Promise**, so they returned a Promise where callers
  expected an object; `data[ch].traffic` on a Promise is `undefined`.
- Nothing mapped GA4's `{rows:[{dimensionValues, metricValues}]}` envelope into
  the `{SEO:{traffic,…}}` shape every caller assumed.

### 3. "Attribution" was a lookup table, not attribution

Credit was assigned by **the channel's index in the `CHANNELS` array**, not by a
touch's position in anyone's path. `first-touch` gave 100% of the credit to
whichever channel happened to be listed first (SEO) and `last-touch` to whichever
was last (Referral) — for every account, forever, regardless of what any customer
did. `data-driven` was a fixed row of constants. With no data the percentage was
`0/0`, rendered as `NaN%`.

### 4. Invented constants throughout the service

A flat trend series (traffic 3000, leads 90, conversions 18, revenue 9000 on
*every* point, dated backwards from today) — charted as performance history and
fed to the anomaly detector and forecaster. Ten fake conversion paths ("SEO →
Email → Direct, 142 conversions, $285 average"). A hardcoded funnel
`[50000, 28000, 14000, 7200, 3600, 2100]` whose drop-offs Claude was asked to
explain. An LTV of $1,240 with a median of $860 and a five-bucket distribution.
A churn rate of 5.2% with risk scores of 89/72/54. A weekly scorecard of 72/100.
A goal projection of `current × 1.3`. An LTV multiplier of `× 3.2`.

The anomaly detector deserves its own note: run over a series where every value
was identical, the standard deviation was 0, every deviation was `0/0 = NaN`,
`Math.abs(NaN) > 2` was false — so it **always** reported "No significant
anomalies detected." A confident all-clear derived from nothing.

### 5. Removing the demo numbers had left division by zero

An earlier pass zeroed the page's demo constants but not the arithmetic over
them. `maxCount = funnel[0].count` was 0, so every funnel bar rendered
`height:NaNpx` with a `-NaN%` drop-off caption under it, and "0.0K" as the count.

### 6. The channel performance chart drew sine waves

`val = 40 + 30·sin((d+seed)·0.3) + 15·cos((d+seed)·0.15)`, five coloured lines
on a 0–100% axis labelled Organic / Paid / Social / Email / Referral. Decoration
that read as a performance chart, and it moved convincingly.

---

## What was done

**One rule: a number is measured or it is named as absent.** Zeros were rejected
as a fix — a dashboard reading "0 conversions, 0% ROI" tells a customer their
marketing failed, when in fact nothing was counted. Every reader now returns
`{ measured, reason, … }` and the UI renders the reason.

- **Real GA4 integration.** `readChannels()` awaits the connector, maps the row
  envelope, and translates GA4's own channel-group names onto this module's
  labels. An unmapped group is dropped rather than guessed at.
- **Honest limits of the source.** GA4 holds no ad spend, so ROI, CAC and spend
  stay `null` with a stated reason rather than being computed against a spend of
  zero. LTV needs repeat-purchase history, so the KPI tile that claimed it now
  reports *average order value* — a real number, correctly named.
- **Real attribution.** `computeAttribution(paths, model)` weights by a touch's
  position in its own path: first/last/linear/time-decay/position-based, with
  percentages guarded against division by zero. Without recorded paths it
  refuses and explains what a touchpoint path is.
- **A funnel of what GA4 can actually fill.** Sessions (awareness) and
  conversions (purchase) are real; the middle stages are returned
  `measured:false` with the event each would need, and drop-off rates are only
  quoted between two measured stages.
- **Guidance is labelled as guidance.** Churn signals and the journey map are
  useful and are kept — flagged `isGuidance` with a line saying they describe
  what to watch for, not a measurement of this account's customers.
- **The two missing methods now exist**, and a test asserts that every method
  the page names is exported by the service, and every connector method the
  service names is exported by the connector — the failure that hid all of this.
- **The page** renders each panel exactly once from what the service returned,
  shows a reason where there is no number, and plots the real GA4 series.

---

## Still not measured, and said so in the UI

These need data sources the product does not yet connect. They are named
plainly rather than filled in:

| Not measured | What it would take |
|---|---|
| ROI, CAC, marketing efficiency | Ad spend from the ad platforms |
| Customer lifetime value | Repeat-purchase history per customer |
| Retention cohorts | Per-customer first-purchase dates and repeat activity |
| Mid-funnel stages | Engagement / consideration / intent events in GA4 |
| Multi-touch conversion paths | Touchpoint capture across sessions |
| Customer segments (on this page) | Purchase history — the agent's rule-based segments over real contacts work today |
