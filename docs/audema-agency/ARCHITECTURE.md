# Audema Agency Edition — Architecture Audit & Phased Plan

Required output per the Agency Edition master prompt §34. Written against the repository as it actually is (see `docs/audema-mcp/CURRENT_ARCHITECTURE.md` for the full prior audit) — not the Prisma/Next.js stack the master prompt assumes.

## 1. Current architecture relevant to this work

- **No ORM, no TypeScript in the main app.** Vanilla JS (`web/js/*.js`) + flat Vercel functions (`api/*.js`) + hand-written idempotent Supabase SQL (`database/*.sql`, root `supabase-*.sql`). The only TypeScript in the repo is `domain/` — a small, self-contained package built this session (Prompt 2 of the separate Audema MCP program), with strict TypeScript + `zod` schemas for 22 shared entities, and `audema-adforge-mcp/` (an unrelated standalone MCP server).
- **Existing tenancy primitive: `intelligence_profiles`.** One row = one business's Intelligence Layer (BusinessBrain, Competitive Radar, Market Pulse, Strategic Brief), owned by a single `owner_id` (`auth.users.id`), with `intelligence_profile_members` (role: `owner`/`editor`/`viewer`) for sharing. Plan-limited: `free`/`basic`=1, `pro`/`professional`=3, `agency`=8, `enterprise`=admin-configured (`web/js/intelligence-profiles.js`).
- **Billing today: none.** `profiles.plan` is a plain `CHECK` text column (`free`/`pro`/`enterprise`, extended to `admin` by `admin-setup.sql`). No Stripe integration anywhere in the repo. Plan changes are manual (SQL or the admin dashboard).
- **RBAC today: two flat vocabularies.** `profiles.role` (account-wide: `user`/`admin`/`super_admin`) and `intelligence_profile_members.role` (workspace-scoped: `owner`/`editor`/`viewer`). Just formalized in `domain/src/entities/role.ts` with a real permission table (`domain/src/enums.ts`'s `Permission` enum) — see `docs/audema-mcp/PERMISSIONS.md`.
- **Auth:** Supabase Auth, `web/js/auth.js`'s `Auth` object (real session-aware, just hardened this session — see the login-persistence fix). `api/admin-users.js` is the established pattern for privileged server-side actions: resolve the caller's real identity/role from their Supabase access token server-side, via the service-role key — never trust a client-supplied claim.
- **Social/content pipeline** (`social_posts` table, `api/generate-*.js`, `api/publish-social-post.js`) and the rest of the Intelligence Layer are all real, working, and scoped to `intelligence_profiles`/`project_id` today — none of this needs to change structurally, only gain an additional ownership layer above it.

## 2. Conflict identified and resolved with the project owner

`docs/audema-mcp/DECISIONS.md` #1 (settled prior to this spec) explicitly chose **not** to introduce a new organization table — `intelligence_profiles` was formalized as "Workspace" directly under a `profiles` account. This spec's seat-based Stripe billing genuinely cannot be built on a text column with no subscription record — there is no way to track `stripeSubscriptionId`/seat count/proration/period dates against a `CHECK (plan IN (...))` field.

**Resolved:** Decision #1 is revised. A new `Agency` entity is introduced *above* `intelligence_profiles`, which becomes "ClientBusiness" (renamed conceptually only — the physical table stays `intelligence_profiles`, avoiding a mass rename across every file that already references `intel_profile_id`). `Agency` owns billing, members, and seats; `ClientBusiness` (`intelligence_profiles`) keeps its exact current scoping and gains an optional `agency_id`. See `docs/audema-agency/DECISIONS.md`.

## 3. Files and database models needing modification

**New SQL** (`supabase-agency.sql`, idempotent, mirrors `supabase-intelligence-profiles.sql`'s style):
- `agencies`, `agency_members`, `agency_invitations`, `client_member_access`, `agency_subscriptions`, `agency_audit_log`.
- `ALTER TABLE intelligence_profiles ADD COLUMN IF NOT EXISTS agency_id ...` (nullable — see §4), plus `account_manager_user_id`, `status`.

**New domain contracts** (`domain/src/entities/*.ts`): `agency.ts`, `agencyMember.ts`, `agencyInvitation.ts`, `clientMemberAccess.ts`, `agencySubscription.ts`, `auditLog.ts`. Extends (not replaces) `domain/src/enums.ts`'s `Permission` vocabulary and `domain/src/entities/workspace.ts` (adds optional `agencyId`/`accountManagerUserId`/`status`).

**New billing module** (`domain/src/billing/agencyPricing.ts`): `calculateAgencyMonthlyPrice()`, pure and fully unit-tested, no Stripe dependency.

**Not modified in this phase:** every existing `api/*.js`, every existing `web/*.html` page, `intelligence-profiles.js`, `intelligence-engine.js`, `social_posts`/publish pipeline. Per the master prompt's own rule ("do not replace working features unnecessarily") and the phased approach, UI wiring (agency dashboard, client switcher, campaign centre, etc.) is later phases, once the foundation is real and tested.

## 4. Risks and conflicts

1. **Existing single-business accounts must keep working unmodified** (explicit requirement). Resolved by making `intelligence_profiles.agency_id` **nullable** — an existing profile with `agency_id IS NULL` behaves exactly as it does today, scoped by `owner_id` alone. Agency scoping is strictly additive.
2. **No Stripe access in this session** (MCP not authorized; no real price IDs exist yet). The pricing module and schema are built and fully tested against mocked responses now; the actual Stripe customer/subscription/webhook wiring is a follow-up phase once you authorize Stripe or provide price IDs, per your answer.
3. **`ClientMemberAccess` vs. existing `intelligence_profile_members`** — these look similar but serve different scopes: `intelligence_profile_members` is direct user-to-profile sharing (still valid, still used for non-agency accounts and BusinessBrain-sharing regardless of agency context); `client_member_access` grants an *agency member* access to a *specific client business within that agency*, gated by the agency member's `AgencyRole`. Kept as two separate tables rather than overloading one — conflating them would break existing sharing behavior for non-agency accounts.
4. **Naming convention drift** — the master prompt's example `Permission` type uses dot-separated names (`clients.create`). The existing `domain/src/enums.ts` (built for the MCP program, already shipped) uses colon-separated `resource:action` (`campaigns:draft`). Adopted the existing convention rather than introducing a second one in the same package — e.g. `clients:create`, `billing:manage`, not `clients.create`.
5. **`intelligence_profiles.status`** — the master prompt's Client Directory (§8) wants `active`/`paused`/`onboarding`/`archived`. `intelligence_profiles` has no status column at all today (rows just exist or don't — deletion is the only "removal" state). Added as a new nullable-with-default column; existing rows default to `'active'`, so nothing already-live changes behavior.

## 5. Phased implementation plan

- **Phase 1 (this phase):** Tenant schema + permission model. `agencies`/`agency_members`/`agency_invitations`/`client_member_access`/`agency_subscriptions`/`agency_audit_log` tables + RLS; `domain/` entities; `AgencyRole` → permission table; seat pricing module; agency-scoped isolation tests. No UI yet.
- **Phase 2:** Agency onboarding flow (master prompt §4) + Client Business creation, reusing `api/enrich-business.js` per the master prompt's own instruction to reuse existing business-onboarding/brand-discovery workflows.
- **Phase 3:** Client context provider + client switcher (§5–6) — the mechanism every existing tool must receive its active-client scope through, validated server-side (never trusted from the client), mirroring `api/admin-users.js`'s "resolve real identity server-side" pattern.
- **Phase 4:** Agency dashboard + client directory (§7–8).
- **Phase 5:** Campaign centre across clients (§9) + calendar/tasks (§10).
- **Phase 6:** Client approval portal (§11).
- **Phase 7:** Stripe wiring (§12–16) — once authorized: real customer/subscription creation, webhook handler, billing UI, connected to the pricing module already built and tested in Phase 1.
- **Phase 8:** Agency branding, navigation/breadcrumb polish, command palette, notifications (§18–21).
- **Phase 9:** Performance hardening at the scale described in §30 (pagination, tenant-aware cache keys, background aggregation) once real usage patterns exist to optimize against.

## 6. Migration strategy

No destructive migration. Every new table is additive; every new column on `intelligence_profiles` is nullable with a safe default. Existing accounts are unaffected until they're explicitly onboarded into an agency (a deliberate action in Phase 2, not a background migration). No existing data is moved, renamed, or reinterpreted. Applied the same way every other migration in this repo is: run manually in the Supabase SQL editor (see `docs/audema-mcp/DECISIONS.md` #7 — no migration tool exists in this project, and this doesn't introduce one).

## 7. Permission model

Builds directly on `domain/src/entities/role.ts` (already shipped): a new `AgencyRoleSchema` (`owner`/`admin`/`account_manager`/`marketing_specialist`/`analyst`/`client_viewer`) with its own permission table, expressed in the *same* `Permission` vocabulary already defined in `domain/src/enums.ts` — extended with the handful of genuinely new scopes this spec needs (`agency:manage`, `billing:manage`, `members:manage`, `clients:create`, `clients:manage`, `clients:archive`, `campaigns:create`, `campaigns:edit`, `campaigns:approve`, `reports:export`, `integrations:manage`). See `docs/audema-agency/PERMISSIONS.md`.

## 8. Stripe billing architecture

See `docs/audema-agency/DECISIONS.md` for the full design. Summary: `calculateAgencyMonthlyPrice()` is a pure function (no network calls) exactly matching the master prompt's worked examples, unit-tested exhaustively including the "must be divisible by 5 above 10 seats" validation. `AgencySubscription` stores Stripe IDs/status/period dates per the suggested model. Webhook processing (signature-verified, idempotent, logged) is designed now, implemented once Stripe is authorized.

## 9. Tests added this phase

- `domain/test/agencyPricing.test.ts` — every worked example in the master prompt (1/2/5/10/15/20/25/30 seats), the divisible-by-5 validation error, and boundary cases (11, 14 seats rejected).
- `domain/test/agencyIsolation.test.ts` — proves an agency member without a `ClientMemberAccess` grant cannot read a client business; proves one agency's client businesses are never visible to another agency; proves role-based permission checks for each `AgencyRole`.
- `npm run build` (tsc, strict) and `npm test` (vitest) both run clean before this phase is considered done, per the master prompt's own definition-of-done discipline (§34), adapted to this repo's actual toolchain (no `lint`/`typecheck`/`test`/`build` npm scripts exist at the repo root — they exist inside `domain/`, which is where all new TypeScript work lives).
