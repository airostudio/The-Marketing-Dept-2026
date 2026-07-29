/**
 * Shared enums. Kept in one file so a status/permission vocabulary is never
 * silently redefined slightly differently in two entity files.
 */
import { z } from 'zod';

/**
 * Explicit approval states, generalized from the two real, working approval
 * patterns already in production (social_posts.status: pending_review /
 * approved / rejected / scheduled / published / archived, and
 * business_brain_history's implicit propose-then-persist pattern).
 * 'draft' covers Prompt 6's "unstructured draft" exception (a production
 * service may create draft assets without a strategic brief ID).
 */
export const ApprovalStateSchema = z.enum([
  'draft',
  'proposed',
  'pending_review',
  'approved',
  'rejected',
  'archived',
]);
export type ApprovalState = z.infer<typeof ApprovalStateSchema>;

/**
 * Account-wide role — matches the live profiles.role CHECK constraint
 * exactly (database/admin-setup.sql:11). Do not add values here without
 * also adding them to that constraint.
 */
export const AccountRoleSchema = z.enum(['user', 'admin', 'super_admin']);
export type AccountRole = z.infer<typeof AccountRoleSchema>;

/**
 * Workspace-scoped role — matches intelligence_profile_members' live role
 * CHECK constraint exactly: CHECK (role IN ('owner','editor','viewer'))
 * (supabase-intelligence-profiles.sql). Corrected from an earlier version
 * of this schema that omitted 'viewer' — that omission meant a real
 * viewer-role membership row would have failed validation against this
 * schema even though the database already accepted it. Do not add further
 * values here until they exist in that table's CHECK constraint.
 */
export const WorkspaceRoleSchema = z.enum(['owner', 'editor', 'viewer']);
export type WorkspaceRole = z.infer<typeof WorkspaceRoleSchema>;

/**
 * Permission scopes. Deliberately the same vocabulary later phases will use
 * for OAuth scopes (Prompt 13) — one permission vocabulary, not two, so a
 * workspace member's internal permission and an external Claude
 * connection's granted scope are checked against the same enum.
 */
export const PermissionSchema = z.enum([
  'businessbrain:read',
  'businessbrain:write',
  'competitors:read',
  'competitors:write',
  'market:read',
  'market:write',
  'strategy:read',
  'strategy:write',
  'creative:read',
  'creative:generate',
  'content:generate',
  'analytics:read',
  'campaigns:read',
  'campaigns:draft',
  'campaigns:publish',
  'crm:read',
  'crm:write',
  'outreach:draft',
  'outreach:send',
  'assets:read',
  'assets:write',

  // Agency Edition (docs/audema-agency/) — same colon convention as above,
  // not the dot-separated style in that program's own example, per
  // docs/audema-agency/DECISIONS.md #4.
  'agency:manage',
  'billing:manage',
  'members:manage',
  'clients:create',
  'clients:manage',
  'clients:archive',
  'campaigns:create',
  'campaigns:edit',
  'campaigns:approve',
  'reports:export',
  'integrations:manage',
]);
export type Permission = z.infer<typeof PermissionSchema>;

/**
 * Agency-scoped role (docs/audema-agency/) — distinct from and layered
 * above WorkspaceRole. WorkspaceRole still governs direct profile sharing
 * (intelligence_profile_members, unaffected by agency membership);
 * AgencyRole governs what an agency member can do across the agency, with
 * ClientMemberAccess further narrowing *which* client businesses they can
 * exercise that role against. See domain/src/entities/agencyMember.ts for
 * the permission table and docs/audema-agency/PERMISSIONS.md for the
 * human-readable version.
 */
export const AgencyRoleSchema = z.enum([
  'owner',
  'admin',
  'account_manager',
  'marketing_specialist',
  'analyst',
  'client_viewer',
]);
export type AgencyRole = z.infer<typeof AgencyRoleSchema>;

/** Lifecycle of an agency member's seat. */
export const AgencyMemberStatusSchema = z.enum(['active', 'suspended', 'removed']);
export type AgencyMemberStatus = z.infer<typeof AgencyMemberStatusSchema>;

/** Lifecycle of an agency invitation. */
export const AgencyInvitationStatusSchema = z.enum(['pending', 'accepted', 'expired', 'revoked']);
export type AgencyInvitationStatus = z.infer<typeof AgencyInvitationStatusSchema>;

/** Agency organization lifecycle — governs read/write vs. read-only access
 *  across every client business under it, per the master prompt's billing
 *  state machine (§14: active/payment_due/restricted/suspended), plus
 *  'cancelled' for the post-cancellation retention window. */
export const AgencyStatusSchema = z.enum(['active', 'payment_due', 'restricted', 'suspended', 'cancelled']);
export type AgencyStatus = z.infer<typeof AgencyStatusSchema>;

/** Client business lifecycle (master prompt §8's Client Directory statuses). */
export const ClientBusinessStatusSchema = z.enum(['onboarding', 'active', 'paused', 'archived']);
export type ClientBusinessStatus = z.infer<typeof ClientBusinessStatusSchema>;

/** ClientMemberAccess's access level — a coarser grant than AgencyRole's
 *  full permission set, scoping an agency member down to what they can do
 *  on ONE specific client business regardless of their agency-wide role. */
export const ClientAccessLevelSchema = z.enum(['full', 'campaigns_only', 'view_only']);
export type ClientAccessLevel = z.infer<typeof ClientAccessLevelSchema>;

/**
 * Where a piece of information came from — required on every entity that
 * carries an evidence mixin (see base.ts). Distinguishes what a human typed,
 * what was scraped, and what a model inferred, per Prompt 3/5's evidence
 * rules ("separate observed facts from Audema's interpretation").
 */
export const EvidenceSourceTypeSchema = z.enum([
  'user_input',
  'website_analysis',
  'document_upload',
  'third_party_provider',
  'ai_inference',
  'manual_research',
]);
export type EvidenceSourceType = z.infer<typeof EvidenceSourceTypeSchema>;

/** Whether a finding was directly observed in source material, or inferred
 *  by an LLM from surrounding context — Prompt 4's "observed vs inferred"
 *  requirement, generalized for reuse anywhere evidence is recorded. */
export const EvidenceNatureSchema = z.enum(['observed', 'inferred']);
export type EvidenceNature = z.infer<typeof EvidenceNatureSchema>;

/**
 * Social/ad platforms — matches the live set of platforms with real
 * generation/publish support today (api/publish-social-post.js's ADAPTERS
 * map and generate-social-posts.js's PLATFORM_STRATEGY), plus 'other' as
 * the documented extension point rather than allowing an untyped string.
 */
export const PlatformSchema = z.enum([
  'LinkedIn',
  'Instagram',
  'Twitter/X',
  'TikTok',
  'Facebook',
  'Meta/Facebook',
  'Google Search',
  'Google Display',
  'YouTube',
  'other',
]);
export type Platform = z.infer<typeof PlatformSchema>;

/** Creative canvas sizes — matches api/render-social-image.js's PLATFORM_SIZES
 *  and Prompt 7's four required dimensions exactly. */
export const CreativeFormatSchema = z.enum(['square', 'portrait', 'landscape', 'story']);
export type CreativeFormat = z.infer<typeof CreativeFormatSchema>;
