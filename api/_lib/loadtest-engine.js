/**
 * api/_lib/loadtest-engine.js — the pure simulation math for the Load Testing
 * Agent: config validation, the arrival-rate model, the ramp/spike VU model,
 * the duration distribution, failure-category selection, and percentile
 * computation.
 *
 * Not a Vercel route (api/_lib/ is excluded from routing) — imported by
 * api/loadtest-create.js (validation) and api/cron-loadtest-tick.js (the
 * actual tick loop). Kept dependency-free and side-effect-free on purpose:
 * every function here takes plain inputs and returns plain outputs, so the
 * whole engine can be unit tested (tests/load-testing/run.js) without a fake
 * database or fake fetch.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * THE SINGLE MOST IMPORTANT FACT ABOUT THIS FILE: every number it produces —
 * job durations, success/failure outcomes, dollar costs — is SYNTHETIC. This
 * file contains zero network calls and must never gain one. It never calls
 * Claude, OpenAI, Gemini, or any other real API, and it never spends a real
 * dollar. "Artificial AI delay" means "draw a number from a distribution
 * that looks like AI latency," nothing more. If you are looking for the
 * place a real provider call could be wired in, there isn't one — that is
 * intentional, see the task's non-negotiable safety constraint.
 * ══════════════════════════════════════════════════════════════════════════
 */

'use strict';

const PERSONA_KEYS = [
  'websiteBuilders', 'siteVisitors', 'existingEditors',
  'ecommerce', 'heavyUsers', 'failureSimulations',
];

/* ── Config validation ──────────────────────────────────────────────────── */

const LIMITS = {
  MAX_VIRTUAL_USERS: 5000,
  MAX_PEAK_VIRTUAL_USERS: 5000,
  MAX_DURATION_DAYS: 14,
  MAX_GENERATION_CONCURRENCY: 500,
  MAX_FAILURE_RATE: 0.5,
};

/**
 * Validate the config shape the frontend builds. Returns { ok: true, config }
 * with defaults filled in, or { ok: false, error } naming the first problem
 * found — never partially fixes an invalid config.
 */
function validateConfig(input) {
  if (!input || typeof input !== 'object') return { ok: false, error: 'config is required' };

  const virtualUsers = Number(input.virtualUsers);
  if (!Number.isFinite(virtualUsers) || virtualUsers < 1 || virtualUsers > LIMITS.MAX_VIRTUAL_USERS) {
    return { ok: false, error: `virtualUsers must be between 1 and ${LIMITS.MAX_VIRTUAL_USERS}` };
  }

  const durationDays = Number(input.durationDays);
  if (!Number.isFinite(durationDays) || durationDays <= 0 || durationDays > LIMITS.MAX_DURATION_DAYS) {
    return { ok: false, error: `durationDays must be between 0 and ${LIMITS.MAX_DURATION_DAYS}` };
  }

  const personaMix = input.personaMix || {};
  let sum = 0;
  const cleanMix = {};
  for (const key of PERSONA_KEYS) {
    const v = Number(personaMix[key]);
    if (!Number.isFinite(v) || v < 0) {
      return { ok: false, error: `personaMix.${key} must be a non-negative number` };
    }
    cleanMix[key] = v;
    sum += v;
  }
  // Allow tiny floating-point slack, but the UI always sends integers that
  // must sum to exactly 100.
  if (Math.round(sum) !== 100) {
    return { ok: false, error: `personaMix must sum to 100 (got ${sum})` };
  }

  const generationConcurrency = Number(input.generationConcurrency);
  if (!Number.isFinite(generationConcurrency) || generationConcurrency < 1 || generationConcurrency > LIMITS.MAX_GENERATION_CONCURRENCY) {
    return { ok: false, error: `generationConcurrency must be between 1 and ${LIMITS.MAX_GENERATION_CONCURRENCY}` };
  }

  // NOTE: peakVirtualUsers is deliberately NOT required to exceed
  // virtualUsers. The task's own example scenario configures virtualUsers:
  // 1,000 with Peak virtual users: 500 — a lower figure — so this is treated
  // as an independent, freely-set field (only capped, like virtualUsers
  // itself) rather than something the engine enforces a relationship on. In
  // activeVirtualUsers() below, a spike only visibly raises the VU count
  // when peakVirtualUsers is actually above the ramp's current baseline;
  // configuring it lower simply means spike windows have no visible effect,
  // which is a legitimate (if unusual) scenario to configure.
  const spikeEnabled = !!(input.spike && input.spike.enabled);
  let peakVirtualUsers = virtualUsers;
  if (spikeEnabled) {
    peakVirtualUsers = Number(input.spike.peakVirtualUsers);
    if (!Number.isFinite(peakVirtualUsers) || peakVirtualUsers < 1 || peakVirtualUsers > LIMITS.MAX_PEAK_VIRTUAL_USERS) {
      return { ok: false, error: `spike.peakVirtualUsers must be between 1 and ${LIMITS.MAX_PEAK_VIRTUAL_USERS}` };
    }
  }

  const artificialAiDelayEnabled = input.artificialAiDelay ? !!input.artificialAiDelay.enabled : true;

  const apiFailureInjectionEnabled = input.apiFailureInjection ? !!input.apiFailureInjection.enabled : true;
  let failureRate = 0.02;
  if (input.apiFailureInjection && input.apiFailureInjection.rate !== undefined) {
    failureRate = Number(input.apiFailureInjection.rate);
  }
  if (!Number.isFinite(failureRate) || failureRate < 0 || failureRate > LIMITS.MAX_FAILURE_RATE) {
    return { ok: false, error: `apiFailureInjection.rate must be between 0 and ${LIMITS.MAX_FAILURE_RATE}` };
  }

  let costPerGenerationUsd = Number(input.costPerGenerationUsd);
  if (!Number.isFinite(costPerGenerationUsd) || costPerGenerationUsd < 0) costPerGenerationUsd = 0.38;

  // ── Calibration passthrough fields ────────────────────────────────────
  // These are never set by the frontend's own request body — they are
  // filled in by api/loadtest-create.js AFTER this function returns,
  // once (and only if) a real calibration call has actually run. They are
  // accepted here too (rather than only via direct mutation) so this
  // function stays the single source of truth for "what a config object
  // looks like" and so tests can construct an already-calibrated config in
  // one call. See api/_lib/loadtest-calibration.js for how they get their
  // real values.
  //
  //   artificialAiDelay.muSeconds — overrides LOGNORMAL_MU for this run's
  //     duration sampling (see sampleDurationMs). null/omitted means "use
  //     the default constant", i.e. today's fully-synthetic behavior.
  //   costUnit — 'usd' (default, unchanged behavior) or 'credits'. Purely a
  //     display/labeling concern: costPerGenerationUsd is reused to carry
  //     whichever unit this names (see the long comment in
  //     api/loadtest-create.js for why the field keeps its name).
  //   usdPerCredit — optional, user-typed, ONLY used to derive a labeled
  //     "estimated" dollar figure in the UI when costUnit is 'credits'.
  //     Never fabricated by this codebase — see the task's PageSpeed
  //     precedent for why no default exchange rate is invented here.
  //   calibrated — true once a real calibration call has actually run and
  //     succeeded for this run. Purely informational for the dashboard.
  let muSeconds = null;
  if (input.artificialAiDelay && input.artificialAiDelay.muSeconds != null) {
    const m = Number(input.artificialAiDelay.muSeconds);
    if (Number.isFinite(m)) muSeconds = m;
  }
  const costUnit = input.costUnit === 'credits' ? 'credits' : 'usd';
  let usdPerCredit = null;
  if (input.usdPerCredit !== undefined && input.usdPerCredit !== null && input.usdPerCredit !== '') {
    const u = Number(input.usdPerCredit);
    if (!Number.isFinite(u) || u < 0) {
      return { ok: false, error: 'usdPerCredit must be a non-negative number, if provided' };
    }
    usdPerCredit = u;
  }
  const calibrated = !!input.calibrated;

  return {
    ok: true,
    config: {
      virtualUsers,
      durationDays,
      personaMix: cleanMix,
      generationConcurrency,
      spike: { enabled: spikeEnabled, peakVirtualUsers },
      artificialAiDelay: { enabled: artificialAiDelayEnabled, muSeconds },
      apiFailureInjection: { enabled: apiFailureInjectionEnabled, rate: failureRate },
      costPerGenerationUsd,
      costUnit,
      usdPerCredit,
      calibrated,
    },
  };
}

/* ── Ramp + spike VU model ──────────────────────────────────────────────── */

/**
 * How many days a spike period lasts, and how often one starts. Documented
 * choice: "once a day for a few hours", so the concurrent-VU chart shows a
 * clearly visible daily spike rather than a constant plateau.
 */
const SPIKE_PERIOD_MS = 24 * 60 * 60 * 1000;   // one spike opportunity per day
const SPIKE_DURATION_MS = 3 * 60 * 60 * 1000;  // each spike lasts 3 hours
const RAMP_FRACTION = 0.05; // ramp up over the first 5% of total duration, down over the last 5%

/**
 * Active VU target at elapsed time `elapsedMs` into a run of `totalMs`,
 * given the base `virtualUsers` and optional `spike` config. Linear ramp up
 * over the first RAMP_FRACTION, steady in the middle, linear ramp down over
 * the last RAMP_FRACTION. If spike.enabled, once per SPIKE_PERIOD_MS the
 * target is linearly pulled up toward spike.peakVirtualUsers and back down
 * over SPIKE_DURATION_MS, layered on top of the ramp (never exceeding it
 * during ramp-up/down, since a spike mid-ramp should still look like a
 * spike relative to the ramp's current baseline, not overshoot it wildly).
 */
function activeVirtualUsers(elapsedMs, totalMs, config) {
  const rampMs = Math.max(1, totalMs * RAMP_FRACTION);
  let rampFactor;
  if (elapsedMs < rampMs) {
    rampFactor = elapsedMs / rampMs;
  } else if (elapsedMs > totalMs - rampMs) {
    rampFactor = Math.max(0, (totalMs - elapsedMs) / rampMs);
  } else {
    rampFactor = 1;
  }
  const base = config.virtualUsers * rampFactor;

  if (!config.spike || !config.spike.enabled) return Math.round(base);

  const posInPeriod = elapsedMs % SPIKE_PERIOD_MS;
  if (posInPeriod >= SPIKE_DURATION_MS) return Math.round(base);

  // Triangular pulse within the spike window: ramp up to the peak at the
  // midpoint, back down by the end — visible as a clear spike, not a cliff.
  const half = SPIKE_DURATION_MS / 2;
  const intensity = 1 - Math.abs(posInPeriod - half) / half; // 0 → 1 → 0
  const peakDelta = Math.max(0, config.spike.peakVirtualUsers - config.virtualUsers) * rampFactor;
  return Math.round(base + peakDelta * intensity);
}

/* ── Arrival model ──────────────────────────────────────────────────────── */

/**
 * Each active VU generates, on average, one job every MINUTES_PER_JOB_PER_VU
 * minutes (documented, retunable constant — a "session" browsing/building a
 * site does not fire a generation request every tick, but does so a handful
 * of times per hour). arrivals ≈ (activeVUs / MINUTES_PER_JOB_PER_VU) ×
 * minutesElapsed.
 */
const MINUTES_PER_JOB_PER_VU = 8;

/** Hard cap on arrivals processed in a single tick — see cron-loadtest-tick.js. */
const MAX_ARRIVALS_PER_TICK = 300;

function computeArrivals(activeVUs, minutesSinceLastTick) {
  const raw = (activeVUs / MINUTES_PER_JOB_PER_VU) * minutesSinceLastTick;
  return Math.min(MAX_ARRIVALS_PER_TICK, Math.max(0, Math.round(raw)));
}

/**
 * Split `count` arrivals across the 6 personas by their configured
 * percentages, using the largest-remainder method so the parts always sum
 * back to `count` exactly (no persona silently absorbs/loses a rounding
 * unit).
 */
function splitByPersonaMix(count, personaMix) {
  const raw = PERSONA_KEYS.map(key => ({ key, exact: (count * (personaMix[key] || 0)) / 100 }));
  const floors = raw.map(r => ({ key: r.key, n: Math.floor(r.exact), rem: r.exact - Math.floor(r.exact) }));
  let assigned = floors.reduce((a, f) => a + f.n, 0);
  let remaining = count - assigned;
  floors.sort((a, b) => b.rem - a.rem);
  for (let i = 0; remaining > 0 && i < floors.length; i++, remaining--) floors[i].n += 1;
  const out = {};
  for (const f of floors) out[f.key] = f.n;
  return out;
}

/* ── Duration distribution ──────────────────────────────────────────────── */

/**
 * Log-normal parameters for "artificial AI delay" jobs, chosen so the
 * simulated aggregate stats land near the target example (median ~100s,
 * P95 ~200s, P99 ~266s — all comfortably inside "median 1-2min, P95 ~3min,
 * P99 ~5min"). mu is the log of the median; sigma controls spread.
 *   median = exp(mu)              → mu = ln(100) ≈ 4.605
 *   P95/median = exp(sigma*1.645) → sigma ≈ 0.42 for a 2x P95/median ratio
 */
const LOGNORMAL_MU = Math.log(100);
const LOGNORMAL_SIGMA = 0.42;

/** Without artificial delay, jobs resolve almost instantly (pure queue/concurrency testing). */
const NO_DELAY_MIN_MS = 200;
const NO_DELAY_MAX_MS = 2000;

/** Box-Muller standard normal sample. */
function randNormal() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * @param {boolean} artificialAiDelayEnabled
 * @param {number|null} [muSeconds] — overrides LOGNORMAL_MU for this one
 *   draw. Used by a CALIBRATED run to center the distribution on a real
 *   measured latency instead of the hardcoded constant — see
 *   computeCalibratedMuSeconds() below and api/_lib/loadtest-calibration.js.
 *   null/undefined/non-finite falls back to LOGNORMAL_MU, i.e. today's
 *   fully-synthetic behavior is unchanged when no calibration ran.
 */
function sampleDurationMs(artificialAiDelayEnabled, muSeconds) {
  if (!artificialAiDelayEnabled) {
    return Math.round(NO_DELAY_MIN_MS + Math.random() * (NO_DELAY_MAX_MS - NO_DELAY_MIN_MS));
  }
  const mu = Number.isFinite(muSeconds) ? muSeconds : LOGNORMAL_MU;
  const seconds = Math.exp(mu + LOGNORMAL_SIGMA * randNormal());
  // Clamp to a sane range: a real generation is never sub-second nor beyond
  // ~15 minutes, however unlucky the draw.
  const clamped = Math.min(900, Math.max(1, seconds));
  return Math.round(clamped * 1000);
}

/**
 * Derive this run's log-normal mu from one real measured latency, so a
 * calibrated run's simulated durations center on reality instead of a
 * hardcoded guess.
 *
 * Formula (documented per the task spec): treat the real measured
 * milliseconds as the target MEDIAN of the distribution (a log-normal's
 * median is exp(mu), same relationship LOGNORMAL_MU already uses for the
 * default 100s target — see that constant's own comment), and solve for mu:
 *
 *   median_seconds = realLatencyMs / 1000
 *   mu = ln(median_seconds)
 *
 * sigma (spread) is deliberately left at LOGNORMAL_SIGMA — one real sample
 * carries no information about spread at all, only about the center, so
 * there is no principled way to recompute it from a single data point; the
 * existing spread shape (~2x P95/median) is kept as-is, per the task's own
 * instruction not to change it without a reason.
 */
function computeCalibratedMuSeconds(realLatencyMs) {
  const ms = Number(realLatencyMs);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return Math.log(ms / 1000);
}

/* ── Failure injection ───────────────────────────────────────────────────── */

/**
 * Weighted failure-category table, roughly matching the example dashboard's
 * proportions (claude_error most common, then image_api_error, then
 * deployment_error, then database_error rarest). Weights are relative, not
 * percentages of all jobs — apiFailureInjection.rate decides how many jobs
 * fail at all; this table only decides which category a failing job gets.
 */
const FAILURE_CATEGORY_WEIGHTS = [
  { category: 'claude_error', weight: 50 },
  { category: 'image_api_error', weight: 30 },
  { category: 'deployment_error', weight: 15 },
  { category: 'database_error', weight: 5 },
];
const FAILURE_WEIGHT_TOTAL = FAILURE_CATEGORY_WEIGHTS.reduce((a, w) => a + w.weight, 0);

function pickFailureCategory() {
  let r = Math.random() * FAILURE_WEIGHT_TOTAL;
  for (const w of FAILURE_CATEGORY_WEIGHTS) {
    if (r < w.weight) return w.category;
    r -= w.weight;
  }
  return FAILURE_CATEGORY_WEIGHTS[FAILURE_CATEGORY_WEIGHTS.length - 1].category;
}

/**
 * Decide a single job's outcome at promotion time (this is a discrete
 * simulation — the whole outcome is precomputed once, never learned by
 * waiting on anything real). Returns { success, failureCategory, durationMs }.
 */
function simulateJobOutcome(config) {
  const durationMs = sampleDurationMs(config.artificialAiDelay.enabled, config.artificialAiDelay.muSeconds);
  if (!config.apiFailureInjection.enabled || Math.random() >= config.apiFailureInjection.rate) {
    return { success: true, failureCategory: null, durationMs };
  }
  return { success: false, failureCategory: pickFailureCategory(), durationMs };
}

/* ── Percentiles ─────────────────────────────────────────────────────────── */

/**
 * Nearest-rank percentile over an array of numbers (durations in ms). Sorts
 * a copy, never mutates the input. Returns null for an empty array.
 */
function percentile(values, p) {
  if (!values || values.length === 0) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

module.exports = {
  PERSONA_KEYS,
  LIMITS,
  validateConfig,
  activeVirtualUsers,
  computeArrivals,
  splitByPersonaMix,
  simulateJobOutcome,
  sampleDurationMs,
  computeCalibratedMuSeconds,
  pickFailureCategory,
  percentile,
  MINUTES_PER_JOB_PER_VU,
  MAX_ARRIVALS_PER_TICK,
  SPIKE_PERIOD_MS,
  SPIKE_DURATION_MS,
  RAMP_FRACTION,
  LOGNORMAL_MU,
  LOGNORMAL_SIGMA,
  FAILURE_CATEGORY_WEIGHTS,
};
