import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { checkBudgetGuardrails, checkCopyPolicyRisk, getMaxDailyBudgetCents } from '../../src/campaigns/guardrails.js';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  delete process.env.ADFORGE_MAX_DAILY_BUDGET_CENTS;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('getMaxDailyBudgetCents', () => {
  it('defaults to $100/day (10000 cents) when unset', () => {
    expect(getMaxDailyBudgetCents()).toBe(10_000);
  });

  it('respects a valid configured ceiling', () => {
    process.env.ADFORGE_MAX_DAILY_BUDGET_CENTS = '50000';
    expect(getMaxDailyBudgetCents()).toBe(50_000);
  });

  it('falls back to the default for a garbage value rather than allowing unlimited spend', () => {
    process.env.ADFORGE_MAX_DAILY_BUDGET_CENTS = 'not-a-number';
    expect(getMaxDailyBudgetCents()).toBe(10_000);
  });

  it('falls back to the default for a zero or negative value', () => {
    process.env.ADFORGE_MAX_DAILY_BUDGET_CENTS = '-500';
    expect(getMaxDailyBudgetCents()).toBe(10_000);
  });
});

describe('checkBudgetGuardrails', () => {
  it('passes a budget under the ceiling', () => {
    process.env.ADFORGE_MAX_DAILY_BUDGET_CENTS = '10000';
    expect(checkBudgetGuardrails(5000)).toEqual([]);
  });

  it('rejects a budget over the ceiling — never clamps it silently', () => {
    process.env.ADFORGE_MAX_DAILY_BUDGET_CENTS = '10000';
    const violations = checkBudgetGuardrails(999_999);
    expect(violations).toHaveLength(1);
    expect(violations[0].field).toBe('dailyBudgetCents');
    expect(violations[0].message).toMatch(/exceeds the configured ceiling/);
  });

  it('rejects a zero or negative budget', () => {
    expect(checkBudgetGuardrails(0)).toHaveLength(1);
    expect(checkBudgetGuardrails(-100)).toHaveLength(1);
  });

  it('rejects an LLM-hallucinated absurd budget regardless of what was "requested"', () => {
    // The whole point: no tool argument, however large, can bypass the env-configured ceiling.
    const violations = checkBudgetGuardrails(50_000_000); // $500,000/day
    expect(violations.length).toBeGreaterThan(0);
  });
});

describe('checkCopyPolicyRisk', () => {
  it('passes ordinary ad copy', () => {
    expect(checkCopyPolicyRisk('Get your free quote today and save on your next project.')).toEqual([]);
  });

  it('flags unsubstantiated guarantee claims', () => {
    const violations = checkCopyPolicyRisk('Guaranteed weight loss in 7 days!');
    expect(violations.some((v) => /guarantee/i.test(v.message))).toBe(true);
  });

  it('flags medical cure claims', () => {
    const violations = checkCopyPolicyRisk('This supplement cures anxiety instantly.');
    expect(violations.length).toBeGreaterThan(0);
  });

  it('flags excessive capitalization', () => {
    const violations = checkCopyPolicyRisk('BUY NOW BEFORE ITS GONE');
    expect(violations.length).toBeGreaterThan(0);
  });
});
