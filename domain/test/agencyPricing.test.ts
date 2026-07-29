import { describe, it, expect } from 'vitest';
import {
  calculateAgencyMonthlyPrice,
  isValidCustomSeatCount,
  calculateSeatUsage,
  canInviteAnotherMember,
  formatCentsAsCurrency,
  InvalidSeatCountError,
  PURCHASABLE_SEAT_OPTIONS,
} from '../src/index';

describe('calculateAgencyMonthlyPrice', () => {
  // Every worked example from the Agency Edition master prompt §12, verbatim.
  it.each([
    [1, 23_500],
    [2, 45_000],
    [5, 105_000],
    [10, 200_000],
    [15, 250_000],
    [20, 300_000],
    [25, 350_000],
    [30, 400_000],
  ])('%i seats -> %i cents', (seats, expectedCents) => {
    expect(calculateAgencyMonthlyPrice(seats)).toBe(expectedCents);
  });

  it('prices every seat count in the flat 3-5 band identically', () => {
    expect(calculateAgencyMonthlyPrice(3)).toBe(105_000);
    expect(calculateAgencyMonthlyPrice(4)).toBe(105_000);
    expect(calculateAgencyMonthlyPrice(5)).toBe(105_000);
  });

  it('prices every seat count in the flat 6-10 band identically', () => {
    expect(calculateAgencyMonthlyPrice(6)).toBe(200_000);
    expect(calculateAgencyMonthlyPrice(9)).toBe(200_000);
    expect(calculateAgencyMonthlyPrice(10)).toBe(200_000);
  });

  it('rejects seat counts above 10 not divisible by five', () => {
    expect(() => calculateAgencyMonthlyPrice(11)).toThrow(InvalidSeatCountError);
    expect(() => calculateAgencyMonthlyPrice(14)).toThrow(InvalidSeatCountError);
    expect(() => calculateAgencyMonthlyPrice(31)).toThrow(InvalidSeatCountError);
  });

  it('rejects zero, negative, and non-integer seat counts without silently coercing', () => {
    expect(() => calculateAgencyMonthlyPrice(0)).toThrow(InvalidSeatCountError);
    expect(() => calculateAgencyMonthlyPrice(-5)).toThrow(InvalidSeatCountError);
    expect(() => calculateAgencyMonthlyPrice(2.5)).toThrow(InvalidSeatCountError);
  });
});

describe('isValidCustomSeatCount', () => {
  it('accepts seat counts above 10 that are divisible by five', () => {
    expect(isValidCustomSeatCount(15)).toBe(true);
    expect(isValidCustomSeatCount(35)).toBe(true);
    expect(isValidCustomSeatCount(100)).toBe(true);
  });

  it('rejects seat counts above 10 not divisible by five', () => {
    expect(isValidCustomSeatCount(11)).toBe(false);
    expect(isValidCustomSeatCount(14)).toBe(false);
  });

  it('rejects seat counts at or below 10, and non-integers', () => {
    expect(isValidCustomSeatCount(10)).toBe(false);
    expect(isValidCustomSeatCount(1)).toBe(false);
    expect(isValidCustomSeatCount(15.5)).toBe(false);
  });
});

describe('PURCHASABLE_SEAT_OPTIONS', () => {
  it('matches the master prompt quick-select list exactly', () => {
    expect(PURCHASABLE_SEAT_OPTIONS).toEqual([1, 2, 5, 10, 15, 20, 25, 30]);
  });

  it('every listed option prices without throwing', () => {
    for (const seats of PURCHASABLE_SEAT_OPTIONS) {
      expect(() => calculateAgencyMonthlyPrice(seats)).not.toThrow();
    }
  });
});

describe('calculateSeatUsage', () => {
  it('counts active members and pending invitations toward used seats', () => {
    const usage = calculateSeatUsage({ purchasedSeats: 10, activeMembers: 6, pendingInvitations: 2 });
    expect(usage.usedSeats).toBe(8);
    expect(usage.availableSeats).toBe(2);
  });

  it('allows availableSeats to go negative when over-committed (caller handles the block, not this function)', () => {
    const usage = calculateSeatUsage({ purchasedSeats: 5, activeMembers: 5, pendingInvitations: 2 });
    expect(usage.availableSeats).toBe(-2);
  });
});

describe('canInviteAnotherMember', () => {
  it('allows another invite when seats remain', () => {
    const usage = calculateSeatUsage({ purchasedSeats: 10, activeMembers: 8, pendingInvitations: 1 });
    expect(canInviteAnotherMember(usage)).toBe(true);
  });

  it('blocks another invite once all seats are used', () => {
    const usage = calculateSeatUsage({ purchasedSeats: 10, activeMembers: 9, pendingInvitations: 1 });
    expect(canInviteAnotherMember(usage)).toBe(false);
  });

  it('blocks another invite when already over-committed', () => {
    const usage = calculateSeatUsage({ purchasedSeats: 5, activeMembers: 5, pendingInvitations: 2 });
    expect(canInviteAnotherMember(usage)).toBe(false);
  });
});

describe('formatCentsAsCurrency', () => {
  it('formats cents as a USD display string', () => {
    expect(formatCentsAsCurrency(23_500)).toBe('$235.00');
    expect(formatCentsAsCurrency(400_000)).toBe('$4,000.00');
  });
});
