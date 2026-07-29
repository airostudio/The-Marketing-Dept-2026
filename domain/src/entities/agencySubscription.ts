/**
 * AgencySubscription — mirrors the master prompt §16 interface exactly,
 * adapted with zod validation. `status` intentionally uses Stripe's own
 * subscription status vocabulary (not this package's AgencyStatus enum) —
 * per the master prompt, "Stripe webhook events must be treated as the
 * source of truth for final subscription status," so this field should
 * read exactly what Stripe reports, not a reinterpretation of it. A
 * separate service-layer mapping (not part of this schema) derives
 * Agency.status (active/payment_due/restricted/suspended/cancelled) FROM
 * this field plus business rules — never the other way around.
 *
 * No Stripe calls happen anywhere in this package (docs/audema-agency/
 * DECISIONS.md #2) — this is schema only, ready to be populated once
 * Stripe is wired up in a later phase.
 */
import { z } from 'zod';
import { AgencySubscriptionIdSchema, AgencyIdSchema } from '../ids';
import { TimestampedSchema } from '../base';

/** Real Stripe subscription statuses (https://docs.stripe.com/api/subscriptions/object#subscription_object-status) */
export const StripeSubscriptionStatusSchema = z.enum([
  'trialing', 'active', 'past_due', 'canceled', 'unpaid',
  'incomplete', 'incomplete_expired', 'paused',
]);
export type StripeSubscriptionStatus = z.infer<typeof StripeSubscriptionStatusSchema>;

export const AgencySubscriptionSchema = TimestampedSchema.extend({
  id: AgencySubscriptionIdSchema,
  agencyId: AgencyIdSchema,
  stripeCustomerId: z.string().min(1),
  stripeSubscriptionId: z.string().min(1),
  stripePriceId: z.string().min(1),
  seatQuantity: z.number().int().positive(),
  status: StripeSubscriptionStatusSchema,
  currentPeriodStart: z.string().datetime({ offset: true }),
  currentPeriodEnd: z.string().datetime({ offset: true }),
  cancelAtPeriodEnd: z.boolean(),
  /** A seat reduction is scheduled for the end of the current period
   *  (master prompt §14) — both fields are set together, cleared together
   *  once the change actually takes effect via webhook. */
  scheduledSeatQuantity: z.number().int().positive().optional(),
  scheduledChangeEffectiveAt: z.string().datetime({ offset: true }).optional(),
});
export type AgencySubscription = z.infer<typeof AgencySubscriptionSchema>;
