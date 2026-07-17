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
 * values exactly (supabase-intelligence-profiles.sql). Do not add 'viewer'
 * or other values here until they exist in that table's CHECK constraint —
 * this schema must never claim more roles are supported than the database
 * actually enforces.
 */
export const WorkspaceRoleSchema = z.enum(['owner', 'editor']);
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
]);
export type Permission = z.infer<typeof PermissionSchema>;

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
