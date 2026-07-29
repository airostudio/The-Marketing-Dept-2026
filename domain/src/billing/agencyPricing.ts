/**
 * Agency Edition seat pricing — the single, centralized, fully-tested
 * source of pricing logic (master prompt §12: "Centralise all pricing
 * logic in a single tested billing module"). No Stripe calls happen here
 * (docs/audema-agency/DECISIONS.md #2) — this is pure, deterministic
 * arithmetic matching the master prompt's worked examples exactly. Amounts
 * are always in cents, matching Stripe's own convention and this
 * project's standing rule of never silently converting between units.
 */

export class InvalidSeatCountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidSeatCountError';
  }
}

/**
 * The initial UI-purchasable seat quantities (master prompt §12: "present
 * the purchasable seat options as..."). Quantities beyond 10 that aren't in
 * this list (e.g. 35, 40) are still validly priceable via
 * calculateAgencyMonthlyPrice() — they're just not one of the initial
 * quick-select buttons; a real enterprise/custom seat count input should
 * call isValidCustomSeatCount() instead of restricting to this list.
 */
export const PURCHASABLE_SEAT_OPTIONS: readonly number[] = [1, 2, 5, 10, 15, 20, 25, 30];

/**
 * Whether `seats` is an allowed custom/enterprise seat count above 10 —
 * "the number above 10 is divisible by five" (master prompt §12).
 */
export function isValidCustomSeatCount(seats: number): boolean {
  if (!Number.isInteger(seats) || seats <= 10) return false;
  return (seats - 10) % 5 === 0;
}

/**
 * Monthly price in cents for a given seat count. Mirrors the master
 * prompt's worked examples exactly:
 *   1 seat -> $235.00, 2 seats -> $450.00, 3-5 seats -> $1,050.00 (flat),
 *   6-10 seats -> $2,000.00 (flat), then $2,000 + $100/seat for every seat
 *   above 10, in minimum increments of five above 10 (10->2000, 15->2500,
 *   20->3000, 25->3500, 30->4000).
 *
 * Never silently coerces an invalid seat count (master prompt: "Do not
 * silently convert invalid seat counts. Show an explanatory validation
 * message.") — throws InvalidSeatCountError with a message suitable for
 * direct display to the agency owner.
 */
export function calculateAgencyMonthlyPrice(seats: number): number {
  if (!Number.isInteger(seats) || seats < 1) {
    throw new InvalidSeatCountError('Seat count must be a whole number of 1 or more.');
  }

  if (seats === 1) return 23_500;
  if (seats === 2) return 45_000;
  if (seats >= 3 && seats <= 5) return 105_000;
  if (seats >= 6 && seats <= 10) return 200_000;

  const additionalSeats = seats - 10;
  if (additionalSeats % 5 !== 0) {
    throw new InvalidSeatCountError(
      'Additional seats above 10 must be purchased in increments of five (e.g. 15, 20, 25, 30).'
    );
  }

  return 200_000 + additionalSeats * 10_000;
}

/**
 * Seat usage accounting (master prompt §13). Client viewers do not consume
 * a seat unless a future configuration change says otherwise — callers
 * must exclude 'client_viewer'-role AgencyMember rows from
 * `activeMembers` before calling this, not this function's job to know
 * about roles.
 */
export interface SeatUsage {
  purchasedSeats: number;
  activeMembers: number;
  pendingInvitations: number;
  usedSeats: number;
  availableSeats: number;
}

export function calculateSeatUsage(params: {
  purchasedSeats: number;
  activeMembers: number;
  pendingInvitations: number;
}): SeatUsage {
  const usedSeats = params.activeMembers + params.pendingInvitations;
  return {
    purchasedSeats: params.purchasedSeats,
    activeMembers: params.activeMembers,
    pendingInvitations: params.pendingInvitations,
    usedSeats,
    availableSeats: params.purchasedSeats - usedSeats,
  };
}

/** Whether sending one more invitation would exceed the purchased seat
 *  count — the exact check the invitation workflow must call before
 *  creating an AgencyInvitation row (master prompt: "Prevent an invitation
 *  when there are no available seats"). */
export function canInviteAnotherMember(usage: SeatUsage): boolean {
  return usage.availableSeats > 0;
}

/** Formats a cents amount as a display string, e.g. 235_00 -> "$235.00". */
export function formatCentsAsCurrency(cents: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
}
