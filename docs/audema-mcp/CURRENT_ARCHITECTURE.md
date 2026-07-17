# Current Architecture — Verified Repository Audit

Every claim below was checked directly against the repository (`airostudio/the-marketing-dept-2026`, branch `claude/test-report-flow-qWqR3`). File paths are cited as evidence. Where something could not be fully confirmed, it is marked **UNCERTAIN** with a note on how to verify it.

## 1. Repository and workspace structure

Not a monorepo, no workspaces/lerna/turborepo/nx config. Three largely disconnected trees at repo root:

- **`web/`** — the live product. Flat directory tree of static `.html` pages (`web/*.html`, `web/agents/*.html`, `web/marketing/*.html`, `web/intelligence/*.html`, `web/seo/*.html`, `web/admin/*.html`) plus `web/js/*.js` shared vanilla-JS modules. No build step, no bundler, no framework.
- **`api/`** — flat Vercel serverless functions, one file per endpoint (`api/*.js`, CommonJS, no Express). This is what's actually deployed and called by `web/`.
- **`backend/`** — a **separate, undeployed** Express + PostgreSQL project (see §2). Has its own `package.json`, its own SQL schema, its own auth middleware. Not wired into the live site.
- **`audema-adforge-mcp/`** — a standalone TypeScript Node project (real MCP SDK), independent of both of the above (see §21).

No root `package.json` — the `api/*.js` layer has zero npm dependencies (built-in `fetch`/`Buffer` only). `backend/package.json` and `audema-adforge-mcp/package.json` are independent, self-contained projects.

## 2. Frontend framework

**None.** Plain HTML + vanilla JS, `<script src>` tags, no React/Vue/Svelte/Angular, no JSX, no TypeScript, no bundler (no webpack/vite/esbuild config anywhere). Confirmed by absence of any framework package and by every page's `<script>` include pattern (e.g. `web/marketing/social-media.html`, `web/hub.html`).

## 3. Backend framework

Two, disconnected:

- **Live/deployed**: none, in the framework sense — `api/*.js` files export a plain `module.exports = async function handler(req, res) {...}`, Vercel's native Node runtime convention. No Express/Fastify/Koa.
- **Undeployed**: `backend/server.js` is a real Express 4 app (`backend/package.json`: express, pg, bcrypt, jsonwebtoken, cors, helmet, express-rate-limit, morgan, joi). It has its own routes (`backend/api/{auth,customers,deals,campaigns,projects,icp,integrations,lifecycle,health-scores,diagnostics}.js`) and its own auth middleware (`backend/middleware/auth.js`). **`web/js/api-client.js:13-14` proves this is not what production talks to**: `API_BASE_URL` resolves to `/api` (same-origin, i.e. the Vercel functions) in production, and only `http://localhost:3000/api` locally — never a separate backend host. Line 69's comment ("404 = endpoint doesn't exist (no backend deployed) → treat as unavailable") confirms the frontend code itself expects this backend may not exist.

## 4. API architecture

REST-ish, one file = one route, no shared router/middleware framework. Auth is not verified per-request by a central layer in `api/*.js` — most endpoints are either public utilities (rate-limited by IP, e.g. `api/generate-ads.js`, `api/lead-enrich.js`) or use a caller-supplied Supabase access token verified inline (`api/admin-users.js`, added this session). Vercel Cron triggers `api/cron-auto-publish.js` on a schedule (`vercel.json`'s `crons` array).

## 5. Authentication and session handling

Supabase Auth (`auth.users`), via `@supabase/supabase-js`, wrapped by `web/js/supabase-client.js`. Two entry points into the same underlying accounts:
- `web/js/auth.js` (`Auth`/`AuthModal` — most internal pages), uses the SDK directly.
- `web/js/auth-modal.js` (index.html/hub.html's landing modal), talks to Supabase's raw REST auth endpoints directly and bridges its session into `auth.js`'s expected localStorage keys, and (as of this session's fixes) also hydrates the real SDK session via `client.auth.setSession()`.
`api/app-config.js` serves the public Supabase URL/anon key from Vercel env vars at runtime (both entry points fetch this if not already cached). Session persistence relies on Supabase's own `persistSession`/`autoRefreshToken` (`web/js/supabase-client.js`).
`backend/middleware/auth.js` implements a separate JWT-based auth scheme for the undeployed Express backend — not used by the live site.

## 6. Organisation and workspace model

**No `organizations` table in the live schema.** `database/supabase-schema.sql:24` — `profiles` is keyed 1:1 to `auth.users.id` (single-user-per-account). The closest things to a "workspace":
- `projects` (`database/supabase-schema.sql:64`) — a lightweight per-account container (one SEO/marketing project), `user_id`-scoped.
- `intelligence_profiles` + `intelligence_profile_members` (`supabase-intelligence-profiles.sql:19,31`) — multi-member capable, plan-limited (1/3/8/admin-configured), the actual mechanism used for BusinessBrain/social_posts scoping today (`intel_profile_id` column pattern, e.g. `supabase-social-posts.sql:20`).
The **only** real `organizations` table in the repo is `backend/database/schema.sql:22`, part of the separate, undeployed Express backend's schema — not part of what's live.

## 7. User roles and permissions

`profiles.role`: `'user' | 'admin' | 'super_admin'` (`database/admin-setup.sql:11`), enforced via RLS `EXISTS` policy checks (same file, `"Admins can view/update all profiles"`). No per-resource or workspace-scoped roles in the live schema. `backend/database/schema.sql:43` has a more granular `'owner'|'admin'|'member'|'viewer'` role — again, only in the undeployed backend.

## 8. Database and ORM

**PostgreSQL via Supabase, no ORM.** No Prisma/Drizzle/TypeORM/Sequelize anywhere. All schema is raw `.sql`, applied manually through the Supabase SQL editor (per `ADMIN_SETUP_GUIDE.md` and comments throughout, e.g. `supabase-social-posts.sql:1-4`). Client access is via `@supabase/supabase-js`'s query builder (`.from(...).select(...)`) directly, or raw `fetch` to Supabase's REST/Auth endpoints for server-side privileged calls (service-role key), e.g. `api/admin-users.js`, `api/ab-track.js`, `api/mcp.js`.

## 9. Existing migrations

No migration tool/history — each `.sql` file is idempotent (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`) and re-runnable, not a sequential migration chain. Inventory:
- Root: `supabase-business-brain.sql`, `supabase-intelligence-profiles.sql`, `supabase-social-posts.sql`, `supabase-ab-testing.sql`.
- `database/`: `supabase-schema.sql` (profiles/projects/audits/keywords/competitors/backlinks/alerts/marketing_campaigns/content_items), `admin-setup.sql` (adds role + `admin_activity_log` + promote/demote functions), `schema.sql` (an overlapping/earlier SEO-tool schema — **UNCERTAIN** whether this is superseded by `supabase-schema.sql` or still applied; verify which one was actually run against the live project before assuming either is authoritative).
- `backend/database/`: `schema.sql` (organizations-based, separate/unused) + `migrations/001_seo_projects.sql`.

## 10. Object storage

Supabase Storage, used in exactly one place: `api/render-social-image.js` best-effort uploads rendered SVG creatives to a public `social-creatives` bucket (auto-created via the Storage REST API on first use) when `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` are configured, added this session to give Instagram/TikTok publish adapters a real hosted image URL. No other storage buckets or usage found.

## 11. Background jobs and queues

Only `api/cron-auto-publish.js`, triggered by Vercel Cron (`vercel.json`: `*/15 * * * *`), which sweeps due `social_posts` rows and publishes them via the platform adapters. No Bull/BullMQ/Inngest/Agenda/Supabase Edge Functions.

## 12. AI model integrations

Four provider proxies in `api/`, all server-side key handling:
- `claude.js` — Anthropic Messages API proxy.
- `gemini.js` — Google Gemini proxy, handles safety-filter/empty-response edge cases.
- `openai.js` — OpenAI chat completions proxy, handles `content_filter` finish reasons.
- `perplexity.js` — Perplexity Sonar (web-search-augmented), returns citations.
Plus task-specific structured-output endpoints built this session: `api/generate-ads.js`, `api/generate-social-posts.js` (both force a Claude tool call for schema-shaped JSON rather than parsing prose).

## 13. Existing agents and orchestration

No formal multi-agent framework (no LangChain/AutoGPT/CrewAI-style orchestrator). "Agents" here means individual product pages under `web/agents/*.html`, each a standalone UI calling one or more of the AI proxy endpoints directly — there is no central orchestrator routing between them today. `scotty.html` + `web/js/scotty-orchestrator.js` is the closest thing to a coordinating layer (**UNCERTAIN** — not deeply audited this pass; verify its actual tool-routing logic before assuming it's a real orchestration engine vs. a single-purpose assistant UI).

## 14. BusinessBrain implementation

Real and substantial, in `web/js/intelligence-engine.js`'s `BusinessBrain` class: company identity, ICP, positioning, objectives, metrics — a weighted `getCompletionScore()` (0-100), scoped per intelligence-profile/project (`_key()`), synced to Supabase via `web/js/business-brain-cloud.js` (`business_brain` + `business_brain_history` tables, append-only history capped at 20 snapshots, `hydrateFromCloud()` newest-wins merge on load). One-shot website-based enrichment exists (`api/enrich-business.js`, real homepage scrape + Perplexity research) and is wired into both `web/intelligence/business-brain.html`'s autofill and (this session) Pulse's research widget. **No formal proposed-vs-approved distinction or `approveBusinessBrainUpdate`/`rejectBusinessBrainUpdate` operations** — saves are direct, though the history log means past states are recoverable via `restoreSnapshot()`.

## 15. Competitive Radar implementation

Real, in `intelligence-engine.js`'s `CompetitiveRadar` class: competitors with `profile` (positioning/targetAudience/keyMessages/tone), `recentMoves`, `borrowedIdeas`, `gaps` (each with priority), `getSummaryForClaude()` for prompt injection. This session wired it into both organic and ad generation prompts (previously tracked but unused downstream). Purely localStorage today — **no Supabase cloud sync for Competitive Radar** (unlike BusinessBrain), so it does not survive a cleared browser/different device. No connector framework for external competitor-data providers.

## 16. Market Pulse implementation

Real, in `intelligence-engine.js`'s `MarketPulse` class: signals tracked, `hasData()`/`getRecentMoves`-equivalent helpers. **Not deeply audited this pass** — confirmed to exist and be structurally analogous to Competitive Radar (localStorage-only); its actual UI surface (`web/intelligence/market-pulse.html`) was not read this session. **UNCERTAIN**: whether it has any real external signal ingestion or is purely manual entry — verify by reading `market-pulse.html`.

## 17. Strategic Brief implementation

Real, in `intelligence-engine.js`'s `StrategicBrief` class (`save`/list pattern seen in earlier `intelligence-engine.js` reads this session, `strategic_briefs` storage key). Its UI (`web/intelligence/strategic-brief.html`) references lead/prospect concepts per an earlier grep this session but was **not deeply read**. **UNCERTAIN**: whether scoring, revision, or approval-state operations exist as named functions — verify by reading `strategic-brief.html` and the `StrategicBrief` class in full.

## 18. Creative or content generation

Substantial and real:
- **Ad copy**: `api/generate-ads.js` — forced-tool-call structured output, 8 named copywriting frameworks (AIDA/PAS/BAB/etc.).
- **Organic posts**: `api/generate-social-posts.js` — platform-aware structured output.
- **Review/approval pipeline**: `social_posts` table (`supabase-social-posts.sql`) — per-post row with `status` (pending_review/approved/rejected/scheduled/published/archived), `publish_status`, `image_render_status` — a real approve/reject/regenerate UI in `web/agents/social-agent.html` (built this session, explicitly modeled on native.no's swipe-review UX).
- **Image rendering**: `api/render-social-image.js` — deterministic SVG layout engine (platform-aware canvas sizes: square/portrait/landscape/story), ported from the standalone `audema-adforge-mcp` MCP server's renderer; no PNG rasterization (no Sharp dependency in the live `api/` layer — SVG displays natively in `<img>`).
- **Publishing**: `api/publish-social-post.js` — real working adapters for Facebook (Graph API), LinkedIn (UGC Posts), X (API v2), Instagram (two-step Graph API media flow), TikTok (Content Posting API init call); Google Ads/YouTube honestly `not_supported`.
- **Standalone AdForge MCP** (`audema-adforge-mcp/`): a *separate*, more elaborate ad-concept + Sharp-based PNG rendering system with brand profiles, 22 MCP tools, JSON-file storage — built earlier this session, not wired into the live web app (its rendering *approach* was ported into `api/render-social-image.js`, but the MCP server itself runs standalone via stdio, not as part of the live product).

## 19. Analytics integrations

`web/js/social-media-service.js` has real (if currently under-connected) methods for engagement metrics/ROI/growth, backed by `web/js/api-connector.js`'s read-only Meta/LinkedIn/Twitter/TikTok Graph API wrappers (require manually-pasted tokens). This session fixed `web/marketing/social-media.html`'s wiring bugs (wrong-case global reference, a call to a `getDashboardData()` method that never existed) so these now actually execute. No dedicated analytics/BI integration (no GA4/Mixpanel/Amplitude SDK) beyond Google PageSpeed/Search Console API references in `web/js/config.js`'s placeholder config. **UNCERTAIN**: whether those Google integrations are actually wired end-to-end or just scaffolded config — not verified this pass.

## 20. Billing and subscription logic

**No payment processor integration at all.** No Stripe (or any processor) SDK/API calls found anywhere in `web/` or `api/`. `profiles.plan` is a plain text column (`'free'|'pro'|'enterprise'`, extended to include `'admin'` by `admin-setup.sql`; `intelligence_profiles`' plan-limit logic in `web/js/intelligence-profiles.js` separately recognizes `'basic'|'pro'|'professional'|'agency'`). Plan changes today are manual (an admin editing `profiles.plan` via SQL or the admin dashoard) — there is no checkout/upgrade flow.

## 21. Testing framework

**No committed test suite.** No jest/vitest/mocha/playwright config, no `tests/`/`__tests__/` directory, no `*.test.js`/`*.spec.js` files anywhere in the repo. `backend/package.json` declares `"test": "jest"` with `jest` as a devDependency, but zero test files exist to back it — a dead script. All verification work done this session (and presumably prior sessions) was ad-hoc: mocked-fetch Node scripts and one-off Playwright browser scripts run and discarded, not committed as a regression suite. `audema-adforge-mcp/package.json` has a `test:e2e` script (build + `scripts/smoke-test.mjs`) — the one place anything resembling a committed test artifact exists, and it's a smoke test, not a suite.

## 22. Deployment infrastructure

Two disconnected paths:
- **Live (Vercel)**: `vercel.json` — static `web/` output, `api/*.js` as serverless functions (1024MB/60s), security headers (CSP/X-Frame-Options/etc.), one cron job. `VERCEL_SETUP.md` documents the actual production env vars (`ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `MCP_SECRET`, per-platform publish/enrichment keys added this session).
- **Docker stack (documented, not live)**: `Dockerfile` (builds `backend/`, Node 20-alpine), `docker-compose.yml` (postgres:16-alpine + the Express backend + nginx reverse-proxying `web/` and `/api/`), `nginx.conf`. `DEPLOYMENT.md` presents this as the "Quick Start (Local Development)" path — it is not what serves the production site.

## 23. Logging and monitoring

No APM/error-tracking service (no Sentry/LogRocket/Datadog/New Relic). `api/diagnostics.js` is a hand-rolled health-check endpoint (pings configured services, returns pass/warn/fail per env-var group, own in-memory IP rate limiter) — a diagnostics tool, not a monitoring service. Logging is plain `console.log`/`console.warn`/`console.error`, present in a minority of `api/` files.

## 24. Existing MCP-related code

Two independent implementations, neither aware of the other:
- **`api/mcp.js`** — hand-rolled JSON-RPC 2.0 endpoint (no official SDK), modeled as a "Convert.com-style A/B testing MCP," HTTP transport, deployed as a Vercel function, uses `SUPABASE_SERVICE_ROLE_KEY` directly for data access, gated by `MCP_SECRET`.
- **`audema-adforge-mcp/`** — a real, standalone TypeScript project using `@modelcontextprotocol/sdk` (`^1.12.0`), stdio transport, 22 tools for ad-concept generation + Sharp-based PNG rendering, its own JSON-file storage, its own `zod`-validated schemas, own `tsconfig`/build (`tsc` → `dist/index.js`), an `inspect` script (MCP Inspector) and a `test:e2e` smoke test. Fully disconnected from both the live Vercel deployment and `api/mcp.js`.
Neither exposes the `/mcp` path / tool catalogue / resources / prompts structure described in the target architecture (Prompt 11) — both would need to be superseded or substantially extended, not incrementally patched, to reach that target. This is a key open decision (see `DECISIONS.md`).
