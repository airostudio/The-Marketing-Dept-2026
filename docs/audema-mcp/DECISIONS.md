# Decisions Log

Open architectural questions raised by comparing the current repository (`CURRENT_ARCHITECTURE.md`) against the requested target (`TARGET_ARCHITECTURE.md`). Each needs an explicit answer from the project owner before the phase that depends on it begins — none are decided unilaterally here.

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

### 2. 🔴 Which MCP implementation is canonical?

**Why it matters:** Prompt 11 asks for one MCP gateway with a specific tool/resource/prompt catalogue at a stable `/mcp` path. Two independent implementations exist today (`api/mcp.js` — hand-rolled JSON-RPC, live on Vercel; `audema-adforge-mcp/` — real SDK, stdio transport, standalone, not deployed to the web).

**Options:**
- (a) Extend `api/mcp.js` in place (already deployed, already HTTP-transport-shaped, already uses the service-role-key pattern this repo trusts) — replace its hand-rolled JSON-RPC with the official SDK's HTTP/streamable transport.
- (b) Port `audema-adforge-mcp/`'s tool set (and its Sharp-based rendering, if kept) into a new Vercel-deployed server using the official SDK, retiring `api/mcp.js`.
- (c) Keep `audema-adforge-mcp/` as a separate stdio-only dev tool and build the real gateway as a third, new implementation.

**Recommendation:** (a) — it's the one actually reachable at a public URL today, and Prompt 11 explicitly requires a deployable remote service at `https://mcp.audema.marketing/mcp`. `audema-adforge-mcp/`'s renderer approach is *already* being reused (ported into `api/render-social-image.js`), so its useful IP isn't stranded even if the server itself is retired.

**Verification before deciding:** confirm `MCP_SECRET`'s current usage/rotation plan in `api/mcp.js` and whether its existing A/B-testing tool surface (Convert.com-style) needs to be preserved for any active caller before folding it into a broader gateway.

---

### 3. 🔴 Is TypeScript / an ORM / a build step in scope?

**Why it matters:** Prompt 2 requires "strict TypeScript types" and reusing "the project's existing validation and ORM libraries." The live `api/` and `web/` layers have neither (see `CURRENT_ARCHITECTURE.md` §2, §8). Introducing either is a foundational, repo-wide decision, not an incidental one — it changes how every future `api/*.js` file is authored, reviewed, and deployed (Vercel needs a build step it doesn't have today).

**Options:**
- (a) Introduce TypeScript + a lightweight runtime validator (`zod`, already a known-good dependency via `audema-adforge-mcp/`) for **new domain-service code only**, compiled to JS at deploy time, leaving existing `api/*.js` files untouched.
- (b) Full-repo TypeScript migration (large, out of scope for "no broad refactor").
- (c) Stay in plain JS, add only runtime validation (no compile step) — smaller lift, loses compile-time guarantees Prompt 2 explicitly asks for.

**Recommendation:** (a) — matches the "no broad refactor" instruction while still satisfying Prompt 2's strict-typing requirement for new code.

**Verification before deciding:** confirm Vercel project settings allow a build step (`buildCommand` is currently `null` in `vercel.json`) without disrupting the existing zero-build static deploy of `web/`.

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
