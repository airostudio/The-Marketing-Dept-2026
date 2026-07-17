/**
 * Permission — the scoped-action vocabulary itself (see enums.ts), plus a
 * PermissionGrant record type for anywhere a specific permission needs to
 * be recorded as explicitly granted to something (an MCP connection, an
 * OAuth-scoped external client — Prompt 13's scope list, which is
 * deliberately this same enum, not a parallel one).
 */
import { z } from 'zod';
import { PermissionSchema } from '../enums';
import { WorkspaceIdSchema } from '../ids';

// PermissionSchema/Permission themselves live in enums.ts (the single
// source of truth for the vocabulary) and are exported from there via
// index.ts — not re-exported here, to avoid an ambiguous double-export in
// the package barrel.

export const PermissionGrantSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  permission: PermissionSchema,
  grantedAt: z.string().datetime({ offset: true }),
});
export type PermissionGrant = z.infer<typeof PermissionGrantSchema>;
