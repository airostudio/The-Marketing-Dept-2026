/**
 * AgencyInvitation — a pending seat. Reserves a seat against the agency's
 * purchased count until accepted, expired, or revoked (master prompt §13:
 * "Pending invitations should reserve a seat to prevent agencies from
 * sending more invitations than their subscription permits"). Seat-count
 * enforcement itself is service logic for a later phase; this is the
 * record that logic reads.
 *
 * tokenHash, not the raw invitation token, is persisted — mirrors the
 * standing project rule that nothing credential-like is ever stored in
 * plaintext (the same principle behind "API keys never client-side").
 * The raw token exists only in the invitation email/link.
 */
import { z } from 'zod';
import { AgencyInvitationIdSchema, AgencyIdSchema, UserIdSchema } from '../ids';
import { TimestampedSchema } from '../base';
import { AgencyRoleSchema, AgencyInvitationStatusSchema } from '../enums';

export const AgencyInvitationSchema = TimestampedSchema.extend({
  id: AgencyInvitationIdSchema,
  agencyId: AgencyIdSchema,
  email: z.string().email(),
  role: AgencyRoleSchema,
  tokenHash: z.string().min(1),
  invitedByUserId: UserIdSchema,
  expiresAt: z.string().datetime({ offset: true }),
  acceptedAt: z.string().datetime({ offset: true }).optional(),
  status: AgencyInvitationStatusSchema,
});
export type AgencyInvitation = z.infer<typeof AgencyInvitationSchema>;
