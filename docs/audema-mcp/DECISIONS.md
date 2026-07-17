# Decisions Log

Open architectural questions raised by comparing the current repository (`CURRENT_ARCHITECTURE.md`) against the requested target (`TARGET_ARCHITECTURE.md`). Items are only marked 🟢 Decided when they follow directly from a hard requirement already stated in the source prompts, or from a standing project rule — not from a preference call. Decision #1 remains genuinely open: it hinges on product/business intent this document has no visibility into, and needs the project owner's answer before Prompt 2 begins.

Status legend: 🔴 Open (blocks later phases) · 🟡 Open (non-blocking, can default safely) · 🟢 Decided

---

### 1. 🔴 What is "workspace" — a new concept, or `intelligence_profiles` formalized?

**Why it matters:** Every entity in Prompt 2's shared-contracts list (Organisation, Workspace, User, Workspace membership, Role, Permission) and every later domain service's scoping rule depends on this. The live schema has no `organizations` table; `intelligence_profiles` + `intelligence_profile_members` is the closest existing multi-member, plan-limited grouping, but it was built for one purpose (BusinessBrain/content scoping), not as a general-purpose workspace primitive.

**Options:**
- (a) Formalize `intelligence_profiles` as "workspace" — rename/extend in place, minimal migration, preserves existing data and RLS patterns.
- (b) Introduce a new `organizations`/`workspaces` table pair (mirroring the shape already sketched, unused, in `backend/database/schema.sql`), and migrate `intelligence_profiles` under it.
- (c) Keep both concepts distinct (organization owns billing/plan; workspace/intelligence_profile owns content scoping) — closer to common SaaS shape, more migration work.

**Recommendation:** (a) for the shortest path with least migration risk, *if* the project doesn't anticipate needing true multi-organization hierarchies (e.g. one agency org with multiple client workspaces) — the plan-limit logic in `web/js/intelligence-profiles.js` already assumes a flat "one account, N profiles" shape that maps cleanly to (a). Needs explicit confirmation before Prompt 2.

**Verification before deciding:** confirm whether any customer-facing plan (agency tier, `PLAN_LIMITS.agency = 8`) is meant to represent multiple *client organizations* under one paying account, or just multiple *businesses* one user manages — that distinction determines whether (a) is actually sufficient.

---

### 2. 🟢 Which MCP implementation is canonical?

**Decided:** `api/mcp.js` is canonical. Not a preference — dictated by Prompt 11's hard requirement that the gateway be "deployable as a remote service" at a public HTTPS URL. `audema-adforge-mcp/` uses stdio transport, a local/subprocess protocol; it cannot serve remote clients over HTTPS without rebuilding its transport layer, at which point it's no longer "extending" that project, it's building a new one in its place. `api/mcp.js` is already HTTP-shaped and already deployed. Action: replace its hand-rolled JSON-RPC with the official SDK's HTTP/streamable transport; port over `audema-adforge-mcp/`'s tool definitions and rendering approach as needed; retire the standalone server once migrated.

**Still needs verification before executing:** `MCP_SECRET`'s current usage/rotation plan and whether its existing A/B-testing (Convert.com-style) tool surface has any active caller that must keep working through the migration.

---

### 3. 🟢 Is TypeScript / an ORM / a build step in scope?

**Decided:** Not really optional — Prompt 2 itself explicitly requires "strict TypeScript types" and runtime validation for the new shared contracts, so TypeScript is introduced for that new code regardless. The only real choice was *how much* of the repo it touches, and of the three options only one is consistent with the standing "no broad refactor" instruction: **introduce TypeScript + `zod` runtime validation for new domain-service code only, compiled to JS at deploy time — existing `api/*.js` files stay untouched.** Full-repo migration would itself be the broad refactor the brief prohibits; staying in plain JS with no compile step would fail Prompt 2's explicit requirement. No ORM — the existing raw-SQL-via-Supabase-client pattern is kept.

**Still needs verification before executing:** confirm Vercel project settings allow a build step (`buildCommand` is currently `null` in `vercel.json`) for the new TypeScript code path without disrupting the existing zero-build static deploy of `web/` and the existing plain-JS `api/*.js` functions.

---

### 4. 🟡 Which SQL file is authoritative: `database/schema.sql` vs `database/supabase-schema.sql`?

**Why it matters:** Both define overlapping SEO-tool tables. Building new migrations on the wrong assumption risks duplicate/conflicting table definitions.

**Recommendation:** Treat `database/supabase-schema.sql` as authoritative (it's the one referenced by `ADMIN_SETUP_GUIDE.md`'s setup instructions and by `admin-setup.sql`'s "run this AFTER" comment), but this needs a two-minute check against the actual live Supabase project's table list before any new migration touches SEO-tool tables.

**Verification:** query the live Supabase project's `information_schema.tables` and diff against both files.

---

### 5. 🟡 Should `backend/` (Express + organizations schema) be revived, or retired?

**Why it matters:** It already contains a real `organizations`-based schema and JWT auth — exactly the shape Decision #1 might otherwise build from scratch. But it's fully disconnected from production today, and reviving it changes the deployment model (Docker/separate host vs. Vercel-only).

**Recommendation:** Retire from an execution standpoint (don't deploy it), but **mine its schema** (`backend/database/schema.sql`) as a reference shape when resolving Decision #1 — it's evidence of prior intent to build exactly this, worth not re-deriving from nothing.

**Verification:** confirm with the project owner whether `backend/` was abandoned deliberately (superseded by the Vercel/Supabase approach) or is still someone's in-progress work before deleting or ignoring it.

---

### 6. 🟢 Preserve the "credentials never client-side" rule

**Decision:** Standing rule from existing project conventions, carried forward without debate: all API keys/secrets (AI providers, publish-platform OAuth tokens, Supabase service-role key) live exclusively in Vercel environment variables. No exceptions for MCP or OAuth work in later phases. This is already how every server-side integration built this session (`api/admin-users.js`, `api/publish-social-post.js`, `api/cron-auto-publish.js`) works, and later phases (MCP Gateway, OAuth) must not regress it.
