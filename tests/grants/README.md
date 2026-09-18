# Government Funding Room

```bash
PLAYWRIGHT_PATH=/opt/node22/lib/node_modules/playwright node tests/grants/run.js
```

Covers the scorecard model in plain node, the pipeline rollup, and the page
itself in a browser (admin gate, assessment, save, forecast).

## What has to be right

**The arithmetic.** Nine criteria, weights totalling exactly 100, each scored
0–10 and contributing `score × weight / 10`. A scorecard that quietly
mis-scores is worse than no scorecard, because it launders a bad call as a
number. Tested at the extremes (0, 50, 100) and at every band boundary the
policy names — 80, 79, 65, 64, 50, 49.

**The inversion.** Three criteria — application workload, matching
contribution, reporting burden — are *costs*. Scored naively, a brutal,
cash-matched, heavily-audited grant would score **well**, which inverts the
entire model. Every criterion is therefore on one axis where 10 always means
"best for Audema", and for the cost criteria that means the burden is light.
The test asserts those three are declared costs and that their top rubric
reads as a light burden.

**An incomplete card is not a verdict.** Unscored criteria count as zero for
the arithmetic, so a half-filled card can look like a "DON'T APPLY" when
nobody has actually judged it. The model reports what is missing, the UI warns
that the total is a floor rather than a verdict, and `isDecisionReady()` is
false until every criterion is scored.

**The forecast doesn't flatter itself.** `secured` counts only what has been
awarded. The pipeline figure is discounted by each opportunity's own
probability score, and opportunities in `not_proceeding` are excluded — an
undiscounted pipeline is the number that makes a funding plan look healthy
right up until nothing lands.

## Note on the harness

The stubs are injected **after** the real `supabase-client.js` / `auth.js`
load, not before. Injected earlier, the real modules overwrite them and the
test silently exercises the offline path while appearing to pass through the
admin gate.
