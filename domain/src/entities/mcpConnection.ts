/**
 * McpConnection — a scoped external Claude connection to the future MCP
 * gateway (Prompt 13's OAuth flow). Neither of the two existing MCP
 * implementations (api/mcp.js, audema-adforge-mcp/) has per-user/per-
 * workspace scoped connections today — api/mcp.js is gated by one shared
 * MCP_SECRET for all callers (see docs/audema-mcp/CURRENT_ARCHITECTURE.md
 * §24) — this is the connection model the canonical gateway
 * (docs/audema-mcp/DECISIONS.md #2) needs to grow into.
 */
import { z } from 'zod';
import { McpConnectionIdSchema, UserIdSchema } from '../ids';
import { TimestampedSchema, WorkspaceScopedSchema } from '../base';
import { PermissionSchema } from '../enums';

export const McpConnectionStatusSchema = z.enum(['active', 'revoked', 'expired']);
export type McpConnectionStatus = z.infer<typeof McpConnectionStatusSchema>;

export const McpConnectionSchema = TimestampedSchema.merge(WorkspaceScopedSchema).extend({
  id: McpConnectionIdSchema,
  /** The Audema user who authorized this connection — every tool call
   *  under this connection is attributable to them, per Prompt 11's "never
   *  trust model-supplied workspace membership" requirement: the
   *  connection, not a claim the model makes, is the source of truth for
   *  which workspace a tool call is scoped to. */
  authorizedByUserId: UserIdSchema,
  clientName: z.string().min(1),
  scopes: z.array(PermissionSchema).min(1),
  status: McpConnectionStatusSchema,
  /** Short-lived access credential expiry — the credential value itself
   *  is never part of this record; only its lifecycle metadata is. */
  accessExpiresAt: z.string().datetime({ offset: true }),
  lastUsedAt: z.string().datetime({ offset: true }).optional(),
  revokedAt: z.string().datetime({ offset: true }).optional(),
});
export type McpConnection = z.infer<typeof McpConnectionSchema>;
