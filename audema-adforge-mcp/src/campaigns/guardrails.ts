/**
 * Server-side spend guardrails for campaign drafts.
 *
 * These checks run regardless of what the calling LLM asks for — a model
 * hallucinating a $50,000 daily budget, or a prompt injection trying to talk
 * it into one, must not be able to create anything with real spend
 * authority above what the operator configured. This is why the ceiling is
 * read from an environment variable, not a tool argument: a tool argument
 * is caller-supplied input, which is exactly what must not be trusted here.
 */

const DEFAULT_MAX_DAILY_BUDGET_CENTS = 10_000; // $100/day — deliberately conservative default

export function getMaxDailyBudgetCents(): number {
  const raw = process.env.ADFORGE_MAX_DAILY_BUDGET_CENTS;
  const parsed = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_DAILY_BUDGET_CENTS;
}

export interface GuardrailViolation {
  field: string;
  message: string;
}

/**
 * Validates a campaign draft request against hard operator-configured
 * limits. Returns an empty array when everything passes; callers must
 * refuse to proceed (never "clamp and continue") when violations exist —
 * silently reducing a requested budget without telling anyone is its own
 * kind of surprising, unauditable behavior.
 */
export function checkBudgetGuardrails(dailyBudgetCents: number): GuardrailViolation[] {
  const violations: GuardrailViolation[] = [];
  const ceiling = getMaxDailyBudgetCents();

  if (!Number.isFinite(dailyBudgetCents) || dailyBudgetCents <= 0) {
    violations.push({ field: 'dailyBudgetCents', message: 'dailyBudgetCents must be a positive number.' });
  } else if (dailyBudgetCents > ceiling) {
    violations.push({
      field: 'dailyBudgetCents',
      message: `Requested daily budget (${(dailyBudgetCents / 100).toFixed(2)}) exceeds the configured ceiling of ${(ceiling / 100).toFixed(2)} (ADFORGE_MAX_DAILY_BUDGET_CENTS). Raise the ceiling in .env if this is intentional — this server will not silently reduce a requested budget instead.`,
    });
  }

  return violations;
}

/**
 * A very small, deliberately conservative pre-check for obviously-disallowed
 * ad copy patterns (unsubstantiated superlatives, all-caps shouting, common
 * prohibited-claim phrasing). This is NOT a substitute for a real platform
 * policy review API (Meta/LinkedIn run far more sophisticated checks server-
 * side on submission) — it exists to catch the most obvious problems before
 * spending an API call, not to certify compliance.
 */
const RISKY_PATTERNS: { pattern: RegExp; reason: string }[] = [
  { pattern: /\bguaranteed?\s+(income|results|weight\s*loss|cure)\b/i, reason: 'Unsubstantiated guarantee claim' },
  { pattern: /\b(cure|cures|curing)\s+\w+/i, reason: 'Medical cure claim' },
  { pattern: /\b100%\s*(guaranteed|risk[- ]free)\b/i, reason: 'Absolute guarantee claim' },
  { pattern: /[A-Z]{6,}/, reason: 'Excessive capitalization (reads as shouting to most ad platform reviewers)' },
];

export function checkCopyPolicyRisk(text: string): GuardrailViolation[] {
  const violations: GuardrailViolation[] = [];
  for (const { pattern, reason } of RISKY_PATTERNS) {
    if (pattern.test(text)) {
      violations.push({ field: 'copy', message: `${reason}: "${text.slice(0, 80)}${text.length > 80 ? '...' : ''}"` });
    }
  }
  return violations;
}
