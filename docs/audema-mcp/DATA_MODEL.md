# Data Model — Shared Domain Contracts

Implementation: `domain/` (package `audema-domain-contracts`). TypeScript + `zod`, per `DECISIONS.md` #3 — new code only, existing `api/*.js` untouched. Every schema below is a real, buildable, tested `.ts` file under `domain/src/`, not a design sketch: `npm run build` compiles clean, `npm test` (vitest) passes 13 tests including the cross-workspace isolation proofs this phase requires.

## 1. How to read this document

For each of the 22 requested entities: what it is, where it lives (`domain/src/...`), and — critically — whether it's a **new type** or a **formalization of something that already exists** in the live product (per `IMPLEMENTATION_STATUS.md`'s exists/exists-in-pieces/does-not-exist mapping). Re-implementing something that already works is waste; this document exists so later phases build the real service *on* these types, not around them.

## 2. Composition pattern — mixins, not copy-paste

Every entity is built by `.merge()`-ing shared base schemas (`domain/src/base.ts`) rather than each file redefining `createdAt`/`workspaceId`/etc. from scratch:

| Mixin | Adds | Applied to |
|---|---|---|
| `TimestampedSchema` | `createdAt`, `updatedAt` (ISO-8601 strings) | Every entity |
| `WorkspaceScopedSchema` | `workspaceId` | Every entity except Organisation, Workspace, User |
| `VersionedSchema` | `version` (positive int) | Entities with real version history today or required by this program: BrandProfile, Audience, Offer, StrategicBrief, Campaign |
| `ApprovableSchema` | `approvalState`, `approvedBy/At`, `rejectedBy/At/Reason` | Every entity that can be proposed/approved/rejected: BrandProfile, Audience, Offer, StrategicBrief, Campaign, CampaignConcept, CreativeAsset |
| `EvidencedSchema` | `source`, `sourceUrl?`, `retrievedAt?`, `confidence` (0–1), `nature` (observed/inferred) | Competitor moves/gaps, MarketSignal |
| `LineageSchema` | `businessBrainVersionId?`, `strategicBriefId?`, `campaignId?`, `campaignConceptId?`, `creativeSpecificationId?`, `templateId?`, `rendererVersion?`, `modelUsed?` | CampaignConcept, CreativeAsset |
| `ExtensionSchema` | one documented, JSON-safe (never `z.any()`) extension field | CreativeAsset, Approval, McpToolInvocation only — the *only* three places this program allows an untyped-shaped field, and even there it's a recursive JSON-value schema, not `any` |

## 3. Consistent identifiers

Every ID is a **branded UUID string** (`domain/src/ids.ts`) — a plain UUID at runtime (matching every live table's `uuid_generate_v4()` primary key), but nominally typed at compile time so, e.g., a `CompetitorId` cannot be passed where a `WorkspaceId` is expected even though both are strings. 21 branded ID types, one per entity, plus `BusinessBrainVersionId` (a forward reference for Prompt 3's versioning, used only in `LineageSchema`).

## 4. Organisation and workspace isolation

Per `DECISIONS.md` #1 (confirmed: one agency manages multiple profiles):

- **Organisation** (`domain/src/entities/organisation.ts`) is **not a new table** — it's a typed projection of the owning `profiles` row (the account that holds `plan`). `OrganisationId` and the owning user's `UserId` are the same UUID value in the database today; they're branded separately in the type system because a workspace's *members* are not necessarily its *owner*.
- **Workspace** (`domain/src/entities/workspace.ts`) maps directly onto the live `intelligence_profiles` table.
- **WorkspaceMembership** (`domain/src/entities/workspaceMembership.ts`) maps onto `intelligence_profile_members`.
- Every other entity carries exactly one `workspaceId` (never a dual `organisationId`/`workspaceId` pair) — the owning organisation is reachable by joining through the workspace, not duplicated onto every child row. This deliberately avoids the two-scope-columns-that-can-disagree problem `supabase-social-posts.sql`'s legacy `project_id`/`intel_profile_id` dual-scoping pattern had to work around with `COALESCE`-style fallbacks.

**Enforcement contract** (`domain/src/workspaceIsolation.ts`): `assertWorkspaceScope()` throws `CrossWorkspaceAccessError` if a record's `workspaceId` doesn't match the caller's authorized workspace; `filterByWorkspace()` is the read-path equivalent for listing operations. `WorkspaceScopedStore<T>` is a minimal in-memory reference implementation proving the contract end-to-end — real Supabase-backed repositories built in later phases must satisfy the exact same two guarantees (no cross-workspace read, no cross-workspace write), with RLS as the defense-in-depth layer beneath the application-level check, mirroring the pattern already used in `api/admin-users.js` (verify the caller's real permission server-side; never trust a client-supplied scope claim).

**Tested** (`domain/test/workspaceIsolation.test.ts`, 5 tests, all passing): reading another workspace's record by ID throws; listing never leaks a foreign workspace's records; the assert/filter utilities behave correctly in isolation; a genuinely-missing ID within the *correct* workspace returns `undefined`, not an error (so "not found" and "not yours" are never conflated).

## 5. Entity-by-entity

| # | Entity | File | Status vs. live product |
|---|---|---|---|
| 1 | Organisation | `entities/organisation.ts` | New type; not a new table (§4) |
| 2 | Workspace | `entities/workspace.ts` | Formalizes `intelligence_profiles` |
| 3 | User | `entities/user.ts` | Formalizes `auth.users`/`profiles` |
| 4 | WorkspaceMembership | `entities/workspaceMembership.ts` | Formalizes `intelligence_profile_members` |
| 5 | Role | `entities/role.ts` | Formalizes `profiles.role` + `intelligence_profile_members.role`; adds `ROLE_PERMISSIONS` RBAC table (new) |
| 6 | Permission | `entities/permission.ts` + `enums.ts` | New — deliberately the same vocabulary Prompt 13's OAuth scopes will use, so there is one permission vocabulary, not two |
| 7 | Brand profile | `entities/brandProfile.ts` | Adapted from `audema-adforge-mcp/src/types.ts`'s real, working `BrandProfileSchema` |
| 8 | Audience | `entities/audience.ts` | Formalizes BusinessBrain's `icp` object as its own addressable entity |
| 9 | Offer | `entities/offer.ts` | New — no dedicated Offer entity exists anywhere today |
| 10 | Competitor | `entities/competitor.ts` | Formalizes `CompetitiveRadar`, adds the `Evidenced` mixin it currently lacks |
| 11 | Market signal | `entities/marketSignal.ts` | Formalizes `MarketPulse` (shape not fully audited — see `CURRENT_ARCHITECTURE.md` §16, marked UNCERTAIN) |
| 12 | Strategic brief | `entities/strategicBrief.ts` | Formalizes `StrategicBrief` class with Prompt 6's full field list (not confirmed already present in full) |
| 13 | Campaign | `entities/campaign.ts` | New richness on top of the flat `marketing_campaigns` table; enforces "structured campaign needs a brief ID" via a discriminated union, not a runtime `if` |
| 14 | Campaign concept | `entities/campaignConcept.ts` | Extends `generate-ads.js`'s real variant shape with Prompt 7's full ad-concept fields + scoring |
| 15 | Creative specification | `entities/creativeSpecification.ts` | Formalizes `api/render-social-image.js`'s actual request shape as a persisted, versioned spec |
| 16 | Creative asset | `entities/creativeAsset.ts` | Formalizes `social_posts.image_url`/`image_render_status`, replaces its ad-hoc `metadata` JSONB with a typed lineage chain |
| 17 | Approval | `entities/approval.ts` | New shared shape generalizing `social_posts.status` and `business_brain_history`'s two bespoke patterns |
| 18 | Experiment | `entities/experiment.ts` | New shared shape alongside (not replacing) `supabase-ab-testing.sql`/`api/mcp.js`'s existing A/B tooling |
| 19 | Performance snapshot | `entities/performanceSnapshot.ts` | New — explicit raw/calculated/estimated three-way split per Prompt 9 |
| 20 | Campaign learning | `entities/campaignLearning.ts` | Entirely new — Marketing Memory does not exist today |
| 21 | MCP connection | `entities/mcpConnection.ts` | New — neither existing MCP implementation has per-connection scoping |
| 22 | MCP tool invocation | `entities/mcpToolInvocation.ts` | New — neither existing MCP implementation has a tool-call audit trail |

## 6. Explicit approval states

`ApprovalStateSchema` (`enums.ts`): `draft | proposed | pending_review | approved | rejected | archived`. `'draft'` exists specifically for Prompt 6's "unstructured draft" exception. This single enum is shared by every `Approvable`-mixed entity — there is one approval vocabulary, not a different one per domain.

## 7. Explicit source and evidence fields

`EvidencedSchema` (`base.ts`) requires `source` (one of `user_input | website_analysis | document_upload | third_party_provider | ai_inference | manual_research`), `confidence` (0–1, a number, not a vague label), and `nature` (`observed | inferred`) — Prompt 4/5's evidence rules ("separate observed facts from Audema's interpretation") enforced at the type level, not left to a comment convention. `Competitor`'s `recentMoves`/`gaps` each carry their own evidence rather than the competitor row as a whole, because different moves are observed at different times with different confidence — and `CompetitorMove.verifiedPerformanceNote` exists specifically so "this ad has run a long time" (a signal) can never be typed in the same field as "this ad is profitable" (a claim requiring real performance data, per Prompt 5's explicit rule).

## 8. Data lineage for generated assets

`LineageSchema` (`base.ts`), applied to `CampaignConcept` and `CreativeAsset`: every field pointing back through the chain that produced it (BusinessBrain version → brief → campaign → concept → specification → template → renderer version → model used) is present and optional (not every generated thing has every link — a concept generated with no active campaign still has a `businessBrainVersionId`). This directly replaces `social_posts.metadata`'s ad-hoc JSONB blob with named, typed fields.

## 9. Soft deletion — deliberately not added

Per requirement #6 ("soft deletion only where it is already an accepted platform pattern") and the audit finding that **no table in the live schema uses soft deletion** (`CURRENT_ARCHITECTURE.md` — every delete found this session, `deleteProspect`, `deleteRisk`, `api/admin-users.js`'s user delete, is a hard delete): no entity in this package has a `deletedAt`/`isDeleted` field. If a future phase wants soft deletion for a specific entity, that's a new platform pattern to introduce deliberately (and retrofit onto existing tables consistently), not something to silently add here.

## 10. What Prompt 2 does not include

- No Supabase migrations yet (see `DECISIONS.md` #4 — SQL migrations are reviewed against current conventions before being written, and haven't been in this phase).
- No actual repository implementations (Supabase-backed reads/writes) — `WorkspaceScopedStore` is an in-memory reference only, proving the *contract*, not a production data-access layer.
- No service operations (`getBusinessContext`, `createStrategicBrief`, etc.) — those are Prompts 3+, built on top of these types.
