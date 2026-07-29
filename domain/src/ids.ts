/**
 * Consistent identifiers — every entity ID in this package is a branded UUID
 * string. Branding gives compile-time nominal typing (a CompetitorId cannot
 * be passed where a WorkspaceId is expected, even though both are plain
 * strings at runtime) while the runtime shape stays a bare UUID, matching
 * every existing table's `uuid_generate_v4()` primary key convention
 * (see supabase-social-posts.sql, supabase-business-brain.sql, etc.).
 *
 * OrganisationId and UserId both currently resolve to the same physical
 * `profiles.id` / `auth.users.id` value for a given account — there is no
 * separate `organizations` table (docs/audema-mcp/DECISIONS.md #1). They
 * are kept as distinct branded types because they are not always the SAME
 * conceptual thing: an invited workspace member (User) is not necessarily
 * the billing-owning account (Organisation) for that workspace.
 */
import { z } from 'zod';

function brandedUuid<Brand extends string>() {
  return z.string().uuid().brand<Brand>();
}

export const OrganisationIdSchema = brandedUuid<'OrganisationId'>();
export type OrganisationId = z.infer<typeof OrganisationIdSchema>;

export const WorkspaceIdSchema = brandedUuid<'WorkspaceId'>();
export type WorkspaceId = z.infer<typeof WorkspaceIdSchema>;

export const UserIdSchema = brandedUuid<'UserId'>();
export type UserId = z.infer<typeof UserIdSchema>;

export const WorkspaceMembershipIdSchema = brandedUuid<'WorkspaceMembershipId'>();
export type WorkspaceMembershipId = z.infer<typeof WorkspaceMembershipIdSchema>;

export const BrandProfileIdSchema = brandedUuid<'BrandProfileId'>();
export type BrandProfileId = z.infer<typeof BrandProfileIdSchema>;

export const AudienceIdSchema = brandedUuid<'AudienceId'>();
export type AudienceId = z.infer<typeof AudienceIdSchema>;

export const OfferIdSchema = brandedUuid<'OfferId'>();
export type OfferId = z.infer<typeof OfferIdSchema>;

export const CompetitorIdSchema = brandedUuid<'CompetitorId'>();
export type CompetitorId = z.infer<typeof CompetitorIdSchema>;

export const MarketSignalIdSchema = brandedUuid<'MarketSignalId'>();
export type MarketSignalId = z.infer<typeof MarketSignalIdSchema>;

export const StrategicBriefIdSchema = brandedUuid<'StrategicBriefId'>();
export type StrategicBriefId = z.infer<typeof StrategicBriefIdSchema>;

export const CampaignIdSchema = brandedUuid<'CampaignId'>();
export type CampaignId = z.infer<typeof CampaignIdSchema>;

export const CampaignConceptIdSchema = brandedUuid<'CampaignConceptId'>();
export type CampaignConceptId = z.infer<typeof CampaignConceptIdSchema>;

export const CreativeSpecificationIdSchema = brandedUuid<'CreativeSpecificationId'>();
export type CreativeSpecificationId = z.infer<typeof CreativeSpecificationIdSchema>;

export const CreativeAssetIdSchema = brandedUuid<'CreativeAssetId'>();
export type CreativeAssetId = z.infer<typeof CreativeAssetIdSchema>;

export const ApprovalIdSchema = brandedUuid<'ApprovalId'>();
export type ApprovalId = z.infer<typeof ApprovalIdSchema>;

export const ExperimentIdSchema = brandedUuid<'ExperimentId'>();
export type ExperimentId = z.infer<typeof ExperimentIdSchema>;

export const PerformanceSnapshotIdSchema = brandedUuid<'PerformanceSnapshotId'>();
export type PerformanceSnapshotId = z.infer<typeof PerformanceSnapshotIdSchema>;

export const CampaignLearningIdSchema = brandedUuid<'CampaignLearningId'>();
export type CampaignLearningId = z.infer<typeof CampaignLearningIdSchema>;

export const McpConnectionIdSchema = brandedUuid<'McpConnectionId'>();
export type McpConnectionId = z.infer<typeof McpConnectionIdSchema>;

export const McpToolInvocationIdSchema = brandedUuid<'McpToolInvocationId'>();
export type McpToolInvocationId = z.infer<typeof McpToolInvocationIdSchema>;

/** BusinessBrain is versioned per workspace, not a separate ID space — this
 *  brands the version identifier (see business_brain_history.id) used by
 *  lineage fields elsewhere in this package. */
export const BusinessBrainVersionIdSchema = brandedUuid<'BusinessBrainVersionId'>();
export type BusinessBrainVersionId = z.infer<typeof BusinessBrainVersionIdSchema>;

// ── Agency Edition (docs/audema-agency/) ────────────────────────────────────

export const AgencyIdSchema = brandedUuid<'AgencyId'>();
export type AgencyId = z.infer<typeof AgencyIdSchema>;

export const AgencyMemberIdSchema = brandedUuid<'AgencyMemberId'>();
export type AgencyMemberId = z.infer<typeof AgencyMemberIdSchema>;

export const AgencyInvitationIdSchema = brandedUuid<'AgencyInvitationId'>();
export type AgencyInvitationId = z.infer<typeof AgencyInvitationIdSchema>;

export const ClientMemberAccessIdSchema = brandedUuid<'ClientMemberAccessId'>();
export type ClientMemberAccessId = z.infer<typeof ClientMemberAccessIdSchema>;

export const AgencySubscriptionIdSchema = brandedUuid<'AgencySubscriptionId'>();
export type AgencySubscriptionId = z.infer<typeof AgencySubscriptionIdSchema>;

export const AuditLogIdSchema = brandedUuid<'AuditLogId'>();
export type AuditLogId = z.infer<typeof AuditLogIdSchema>;
