/**
 * User — an individually authenticated person (auth.users + profiles).
 * accountRole is platform-wide (profiles.role); a user's access to any
 * given Workspace is governed separately by WorkspaceMembership.
 */
import { z } from 'zod';
import { UserIdSchema } from '../ids';
import { TimestampedSchema } from '../base';
import { AccountRoleSchema } from '../enums';

export const UserSchema = TimestampedSchema.extend({
  id: UserIdSchema,
  email: z.string().email(),
  firstName: z.string().max(100).optional(),
  lastName: z.string().max(100).optional(),
  /** profiles.role — platform-wide, not workspace-scoped. */
  accountRole: AccountRoleSchema,
});
export type User = z.infer<typeof UserSchema>;
