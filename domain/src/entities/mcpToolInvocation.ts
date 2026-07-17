/**
 * McpToolInvocation — the audit record Prompt 11 requires ("Record tool
 * invocation audits"). Neither existing MCP implementation has this today
 * (api/mcp.js has no per-call audit trail beyond its shared-secret gate);
 * this is the shape new gateway code should write on every call, read-vs-
 * generation-vs-consequential separated so a security review can answer
 * "what could this connection have changed" without re-deriving it from
 * tool names.
 */
import { z } from 'zod';
import { McpToolInvocationIdSchema, McpConnectionIdSchema } from '../ids';
import { TimestampedSchema, WorkspaceScopedSchema, ExtensionSchema } from '../base';

export const ToolInvocationKindSchema = z.enum(['read', 'generation', 'consequential']);
export type ToolInvocationKind = z.infer<typeof ToolInvocationKindSchema>;

export const McpToolInvocationOutcomeSchema = z.enum(['success', 'error', 'denied', 'rate_limited']);
export type McpToolInvocationOutcome = z.infer<typeof McpToolInvocationOutcomeSchema>;

export const McpToolInvocationSchema = TimestampedSchema.merge(WorkspaceScopedSchema).extend({
  id: McpToolInvocationIdSchema,
  connectionId: McpConnectionIdSchema,
  toolName: z.string().min(1),
  kind: ToolInvocationKindSchema,
  /** Validated arguments actually used — never the raw, unvalidated
   *  model-supplied payload; validation happens before this record is
   *  written (Prompt 11: "validate all tool arguments"). */
  arguments: ExtensionSchema,
  outcome: McpToolInvocationOutcomeSchema,
  /** Internal database IDs are not necessarily surfaced back to the
   *  calling model (Prompt 11: "Do not expose internal database IDs
   *  unnecessarily") — this field records what was actually returned
   *  for audit purposes even when the response to the caller was
   *  deliberately narrower. */
  resultSummary: z.string().optional(),
  errorMessage: z.string().optional(),
  durationMs: z.number().int().nonnegative().optional(),
});
export type McpToolInvocation = z.infer<typeof McpToolInvocationSchema>;
