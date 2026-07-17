/**
 * Approval — the shared entity Prompt 14's Approval service will operate
 * on. Two bespoke, working approval patterns already exist (social_posts.
 * status, business_brain_history) — this is the generalized shape they
 * should eventually both be expressible in terms of, not a third, unrelated
 * pattern (docs/audema-mcp/TARGET_ARCHITECTURE.md §3.6).
 */
import { z } from 'zod';
import { ApprovalIdSchema, UserIdSchema } from '../ids';
import { TimestampedSchema, WorkspaceScopedSchema, ExtensionSchema } from '../base';

export const ApprovalDecisionSchema = z.enum(['pending', 'approved', 'rejected', 'expired']);
export type ApprovalDecision = z.infer<typeof ApprovalDecisionSchema>;

export const ApprovalSchema = TimestampedSchema.merge(WorkspaceScopedSchema).extend({
  id: ApprovalIdSchema,
  /** The user or agent (e.g. an MCP tool invocation) requesting the
   *  action. A non-human requester is represented as the UserId of the
   *  workspace member who authorized the automation, never as "no one" —
   *  every approval must be traceable to an accountable human. */
  requestedByUserId: UserIdSchema,
  actionType: z.string().min(1),
  /** The MCP tool name, if this approval was raised by a tool invocation
   *  (see McpToolInvocation) rather than an internal UI action. */
  tool: z.string().optional(),
  /** The proposed change itself. Typed as the documented extension schema
   *  (JSON-safe, not `any`) because a proposed payload's shape varies by
   *  actionType — every actionType's payload shape should be documented
   *  wherever that action type is defined, not left to this generic field
   *  alone. */
  proposedPayload: ExtensionSchema,
  humanReadableSummary: z.string().min(1),
  decision: ApprovalDecisionSchema,
  decidedByUserId: UserIdSchema.optional(),
  decidedAt: z.string().datetime({ offset: true }).optional(),
  expiresAt: z.string().datetime({ offset: true }).optional(),
});
export type Approval = z.infer<typeof ApprovalSchema>;
