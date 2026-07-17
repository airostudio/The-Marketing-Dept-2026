/**
 * Shared base schemas, composed into every entity via `.extend()` /
 * `z.object({ ...X.shape, ... })` rather than duplicated field-by-field.
 * Keeping these in one place is what makes "created/updated/version fields
 * where appropriate", "explicit approval states", and "explicit source and
 * evidence fields" consistent across all 22 entities instead of each one
 * inventing its own shape.
 */
import { z } from 'zod';
import { WorkspaceIdSchema, UserIdSchema } from './ids';
import { ApprovalStateSchema, EvidenceSourceTypeSchema, EvidenceNatureSchema } from './enums';

/** Every timestamp in this package is an ISO-8601 string, matching how
 *  every existing table already returns TIMESTAMPTZ columns through
 *  Supabase's REST/JS client — never a Date object, which doesn't survive
 *  JSON serialization at an API or MCP boundary without an explicit
 *  reviver. */
const isoTimestamp = () => z.string().datetime({ offset: true });

/** id + createdAt + updatedAt — the minimum every persisted entity carries. */
export const TimestampedSchema = z.object({
  createdAt: isoTimestamp(),
  updatedAt: isoTimestamp(),
});
export type Timestamped = z.infer<typeof TimestampedSchema>;

/**
 * Workspace isolation — the single field every domain entity in this
 * package (other than Organisation, User, and Workspace itself) MUST carry.
 * Maps to intelligence_profiles.id per docs/audema-mcp/DECISIONS.md #1 —
 * there is no separate organizationId column anywhere: the owning
 * organisation is reachable via workspace.organisationId, not duplicated
 * onto every child row (avoids the two-scope-columns-that-can-disagree
 * problem the legacy project_id/intel_profile_id dual-scoping pattern in
 * supabase-social-posts.sql had to work around).
 */
export const WorkspaceScopedSchema = z.object({
  workspaceId: WorkspaceIdSchema,
});
export type WorkspaceScoped = z.infer<typeof WorkspaceScopedSchema>;

/**
 * Optimistic-concurrency / history version counter. Only added to entities
 * that are actually versioned in practice today (BusinessBrain-lineage
 * concepts) or that this program explicitly requires a version history for
 * (Strategic Brief, Campaign Concept) — not bolted onto every entity
 * uniformly, per "created, updated and version fields where appropriate."
 */
export const VersionedSchema = z.object({
  version: z.number().int().positive(),
});
export type Versioned = z.infer<typeof VersionedSchema>;

/**
 * Explicit approval state, generalized from social_posts.status and
 * BusinessBrain's history pattern. approvedBy/approvedAt/rejectedReason are
 * optional because a 'draft' or 'proposed' record has none of them yet.
 */
export const ApprovableSchema = z.object({
  approvalState: ApprovalStateSchema,
  approvedBy: UserIdSchema.optional(),
  approvedAt: isoTimestamp().optional(),
  rejectedBy: UserIdSchema.optional(),
  rejectedAt: isoTimestamp().optional(),
  rejectedReason: z.string().max(2000).optional(),
});
export type Approvable = z.infer<typeof ApprovableSchema>;

/**
 * Explicit source and evidence fields — required wherever a piece of
 * information could plausibly be challenged ("where did this come from?").
 * confidence is 0–1, not a vague label, so downstream logic can threshold
 * on it consistently. sourceUrl/retrievedAt are optional because
 * 'user_input' evidence has neither.
 */
export const EvidencedSchema = z.object({
  source: EvidenceSourceTypeSchema,
  sourceUrl: z.string().url().optional(),
  sourceDescription: z.string().max(500).optional(),
  retrievedAt: isoTimestamp().optional(),
  confidence: z.number().min(0).max(1),
  nature: EvidenceNatureSchema,
});
export type Evidenced = z.infer<typeof EvidencedSchema>;

/**
 * Data lineage for generated assets (Prompt 7's explicit lineage
 * requirement, generalized for reuse anywhere something is AI-generated
 * downstream of BusinessBrain/a brief/a campaign). Every field is optional
 * because not every generated entity has all of them (a piece of content
 * generated with no active campaign still has a businessBrainVersionId).
 */
export const LineageSchema = z.object({
  businessBrainVersionId: z.string().uuid().optional(),
  strategicBriefId: z.string().uuid().optional(),
  campaignId: z.string().uuid().optional(),
  campaignConceptId: z.string().uuid().optional(),
  creativeSpecificationId: z.string().uuid().optional(),
  templateId: z.string().optional(),
  rendererVersion: z.string().optional(),
  modelUsed: z.string().optional(),
});
export type Lineage = z.infer<typeof LineageSchema>;

/**
 * The one, documented extension point this program allows in place of an
 * untyped JSON blob (requirement: "No untyped JSON blobs for core domain
 * entities unless there is a documented extension field"). Entities that
 * need it include it explicitly as `extension`, never as a bare `data`/
 * `metadata: any` field. Keys are free-form; values are JSON-safe
 * primitives/arrays/objects only — not functions, not class instances —
 * enforced by the recursive schema below rather than `z.any()`.
 */
const JsonPrimitive = z.union([z.string(), z.number(), z.boolean(), z.null()]);
type JsonValue = z.infer<typeof JsonPrimitive> | JsonValue[] | { [key: string]: JsonValue };
const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([JsonPrimitive, z.array(JsonValueSchema), z.record(JsonValueSchema)])
);
export const ExtensionSchema = z.record(JsonValueSchema);
export type Extension = z.infer<typeof ExtensionSchema>;
