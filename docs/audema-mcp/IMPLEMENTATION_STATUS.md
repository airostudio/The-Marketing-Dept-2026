# Implementation Status

Capability-by-capability mapping of the full 14-prompt program against what actually exists in the repository today, followed by a staged plan. Status values: ✅ Exists and matches shape · 🟨 Exists in pieces, different shape · ⬜ Does not exist yet.

## Prompt 2 — Shared domain contracts

| Entity | Status | Evidence / gap |
|---|---|---|
| Organisation | ⬜ | No `organizations` table live (see `DECISIONS.md` #1). Exists only in unused `backend/database/schema.sql`. |
| Workspace | 🟨 | `intelligence_profiles` (`supabase-intelligence-profiles.sql`) is the closest analog — multi-member, plan-limited, but not named/shaped as "workspace." |
| User | ✅ | `auth.users` + `profiles` (`database/supabase-schema.sql:24-36`). |
| Workspace membership | 🟨 | `intelligence_profile_members` with `role` (owner/editor) — real but scoped to one feature area, not universal. |
| Role / Permission | 🟨 | `profiles.role` (user/admin/super_admin) is account-wide, not per-workspace. No granular per-resource permission model. |
| Brand profile | ✅ | BusinessBrain's `positioning`/`company` fields; no separate visual-tokens entity yet. |
| Audience | 🟨 | BusinessBrain's `icp` object covers this conceptually; no standalone `Audience` entity with its own lifecycle. |
| Offer | ⬜ | No dedicated offer entity; ad generation takes ad-hoc `product`/`offer` text per request. |
| Competitor | ✅ | `CompetitiveRadar` class — real, structured, but localStorage-only (no cloud table). |
| Market signal | ✅ | `MarketPulse` class — real, structured, localStorage-only. |
| Strategic brief | ✅ | `StrategicBrief` class exists; depth not fully audited (see `CURRENT_ARCHITECTURE.md` §17). |
| Campaign | 🟨 | `marketing_campaigns` table exists (`database/supabase-schema.sql`); no rich campaign-plan entity (channel plan, content matrix, timeline). |
| Campaign concept | ⬜ | Ad "variants" from `generate-ads.js` are the closest analog — ephemeral, not persisted as a first-class concept entity. |
| Creative specification | 🟨 | Implicit in `render-social-image.js`'s request shape (headline/subheadline/cta/platform/visualDirection) — not a named, persisted spec entity. |
| Creative asset | ✅ | `social_posts.image_url` + `image_render_status`, real lineage-lite (batch_id, source). |
| Approval | 🟨 | Two bespoke patterns exist (`social_posts.status`, `business_brain_history`) — no shared `Approval` entity/service. |
| Experiment | 🟨 | `supabase-ab-testing.sql` + `api/mcp.js`'s Convert-style tooling — real but narrowly scoped to A/B test tracking, not general campaign experiments. |
| Performance snapshot | 🟨 | `social-media-service.js`'s engagement/ROI methods operate on locally-logged data, not ingested platform snapshots with raw/calculated/estimated distinction. |
| Campaign learning | ⬜ | No Marketing Memory concept exists. |
| MCP connection | 🟨 | `MCP_SECRET`-gated single shared secret (`api/mcp.js`) — not per-user/per-workspace scoped connections. |
| MCP tool invocation | 🟨 | No audit log for MCP tool calls specifically (general `admin_activity_log` exists for admin actions only). |

**Net:** roughly a third of Prompt 2's entities already exist in solid form; the rest exist as adjacent, differently-shaped implementations, or not at all. Building the formal shared types is real, additive work — not a rename exercise — once Decision #1/#3 are resolved.

## Prompt 3 — BusinessBrain service

| Operation | Status |
|---|---|
| `getBusinessContext` | 🟨 — `getContextBundle()` exists and is used by every generation prompt this session; not named/shaped identically. |
| `analyseBusiness` / `analyseWebsiteBrand` | ✅ — `api/enrich-business.js` (homepage scrape + Perplexity), already wired into Pulse's research widget this session. |
| `proposeBusinessBrainUpdate` / `approveBusinessBrainUpdate` / `rejectBusinessBrainUpdate` | ⬜ — enrichment results are currently merged **directly** into empty fields (best-effort, non-destructive to *filled* fields), not staged as a proposal requiring explicit approval. This is the single biggest gap versus Prompt 3's "must never silently overwrite approved data" / "persistent changes require explicit approval" rules. |
| `getBusinessBrainVersion` / `compareBusinessBrainVersions` | ✅ — `business_brain_history` + `listHistory()`/`restoreSnapshot()` already do most of this. |

**Net:** the data model and history/versioning are real and solid. The approval workflow (propose → review → approve/reject) does not exist — today's enrichment writes are auto-applied to empty fields, which is safer than overwriting but is not the same as an approval gate.

## Prompt 4 — Customer Voice Intelligence

⬜ **Does not exist.** No feedback ingestion, clustering, or theme-extraction service anywhere in the repo. This is genuinely new work, though `CompetitiveRadar`'s "borrowed ideas"/"gaps" pattern is a reasonable structural precedent for "finding with source + confidence" shape.

## Prompt 5 — Competitive Radar & Market Pulse

| Operation | Status |
|---|---|
| Competitor profile/observation storage | ✅ — `CompetitiveRadar` class. |
| `analyseCompetitorWebsite/Positioning/Offers/CreativeStyle` | ⬜ — no automated competitor-analysis pipeline; radar entries are manually entered today. |
| `detectCompetitorChange` | ⬜ — no diffing/change-detection over time. |
| Market signal storage | ✅ — `MarketPulse` class. |
| `detectEmergingThemes` / seasonal / industry-change detection | ⬜ — not implemented. |
| Evidence rules (observed vs. interpreted, staleness detection, no "profitable" claims without verified data) | ⬜ — not enforced anywhere; current classes store raw text fields with no source/confidence/timestamp discipline. |
| Cloud persistence | ⬜ — both classes are localStorage-only (unlike BusinessBrain), a real gap for "survives across devices." |

**Net:** the domain shape exists; the evidence discipline, change detection, and automated analysis operations are the real net-new work here.

## Prompt 6 — Strategic Brief & Campaign Architect

`StrategicBrief` class exists (storage/list pattern) but was not read in full this pass — **UNCERTAIN**, verify before assuming scoring/approval operations exist. Campaign Architect (channel plan, content matrix, timeline, deliverables, measurement plan, scenario forecasting) — ⬜ **does not exist**; `marketing_campaigns` is a flat table with no plan-object richness.

## Prompt 7 — Creative Intelligence & static-ad renderer

| Capability | Status |
|---|---|
| Ad concept generation | ✅ — `generate-ads.js`, 8 frameworks, forced structured output. |
| Ad concept scoring | ⬜ — no scoring dimensions (audience relevance, distinctiveness, compliance risk, etc.) computed anywhere; frameworks are selected, not scored post-hoc. |
| `renderStaticAd` | ✅ — `render-social-image.js`, deterministic SVG layout, platform-aware sizing (square/portrait/landscape/story — matches the four required dimensions: 1080×1080, 1080×1350, 1080×1920 map directly; 1200×628 maps to the existing `landscape` size). |
| Brand alignment check | ⬜ — not implemented. |
| Asset lineage (BusinessBrain version, brief, campaign, concept, spec, template, renderer version, approval state) | 🟨 — partial: `social_posts.metadata` JSONB + `batch_id` give some lineage, but not the full chain requested. |
| "Do not render critical text with generated imagery" | ✅ — already true by construction: the SVG renderer draws all text programmatically; images (when hosted) are backgrounds/composites, never a source of rendered text. |

**Net:** the rendering engine itself is genuinely strong and already matches most of Prompt 7's technical requirements (deterministic layout, safe zones implied by margin math, platform sizing, no-text-in-generated-imagery). Scoring and full lineage are the real gaps.

## Prompt 8 — Content, SEO, Landing Page services

| Service | Status |
|---|---|
| Content Studio (`createBlogArticle`, `createLinkedInPost`, etc.) | 🟨 — `generate-social-posts.js` covers per-platform organic posts; no blog/newsletter/video-script/carousel-brief generation found. |
| SEO Intelligence | 🟨 — a real, apparently mature SEO toolset exists under `web/seo/*.html` (audits, keywords, backlinks, indexing, competitors, mobile, vitals per file names) — **not deeply audited this pass**, but per `MARKETING_PLATFORM_STRATEGIC_REVIEW.md`'s own prior assessment, this is described as the platform's most complete area. Verify current state before assuming gaps. |
| Landing Page Optimisation | ⬜ — no landing-page analysis/message-match/wireframe-spec service found. |

## Prompt 9 — Analytics, Experiments, Marketing Memory

| Service | Status |
|---|---|
| Marketing Analytics | 🟨 — `social-media-service.js` + `api-connector.js` give real (if under-connected until this session's fixes) engagement/ROI/growth methods; no unified dashboard combining raw/calculated/estimated/inferred distinctly. |
| CRO Experiments | 🟨 — `supabase-ab-testing.sql` + `api/mcp.js`'s Convert-style tooling exist; no hypothesis/guardrail-metric/decision/learning structure. |
| Marketing Memory | ⬜ — does not exist. This is a meaningful gap: nothing today prevents re-recommending a previously-rejected idea. |

## Prompt 10 — CRM, Outreach, Listening, Reputation

| Service | Status |
|---|---|
| CRM/Lead Intelligence | ✅ — `web/marketing/lead-generation.html` has real lead scoring (`calcPriorityScore`), enrichment (`api/lead-enrich.js`, Hunter.io + Perplexity), and (this session) manual-edit fallback when enrichment finds nothing. |
| Outreach (draft-only) | 🟨 — "Draft Outreach" exists in the lead-generation UI (`draftOutreach()`); scope of prospect research/personalization depth not fully audited. |
| Social Listening | ⬜ — not found. |
| Reputation Management | ⬜ — not found. |
| Suppression/do-not-contact/consent/compliance metadata | ⬜ — not found anywhere in the lead/outreach data model. |

## Prompt 11 — MCP Gateway

⬜ **Does not exist in the requested shape.** Two disconnected, non-matching implementations exist (`api/mcp.js`, `audema-adforge-mcp/`) — see `DECISIONS.md` #2. Neither exposes the requested tool catalogue, `audema://` resource URIs, or prompt library. Building this is genuinely new work once Decision #2 is resolved, though `audema-adforge-mcp/`'s tool-definition patterns and the official-SDK dependency are directly reusable.

## Prompt 12 — Claude orchestration inside Audema

⬜ **Does not exist.** No tool-calling loop, no permission-scoped tool selection, no approval-before-consequential-action flow. `scotty.html`/`scotty-orchestrator.js` is the nearest candidate surface — **UNCERTAIN**, not deeply audited; verify whether it does any real tool-calling today or is a single-purpose chat UI before assuming it's a head start.

## Prompt 13 — OAuth & external Claude connectivity

⬜ **Does not exist.** No OAuth authorization-code flow, no scope system, no connection-listing/revocation UI. This is genuinely new work. The one directly relevant precedent: this session's `api/admin-users.js` pattern (verify caller's Supabase access token → check role via service-role key → act) demonstrates the "resolve real permission from an authenticated identity, never trust client-supplied claims" principle the OAuth flow would need to follow.

## Prompt 14 — Approvals, Compliance, safe execution

🟨 **Exists in pieces, no shared service.** `social_posts.status` (approve/reject/regenerate) and `business_brain_history` (versioned, restorable) are two real, working, production examples of the approval pattern Prompt 14 wants generalized — good precedent, not yet a shared service other domains could plug into.

---

## Staged implementation plan (based on what actually exists)

This sequencing accounts for what's already built (reuse), what's adjacent (extend), and what's genuinely new (build), and respects the dependency Decision #1/#2/#3 create.

**Stage 0 — resolved.** All three blocking questions in `DECISIONS.md` are now decided: #1 (workspace = `intelligence_profiles` formalized in place, confirmed by the project owner: one agency manages multiple profiles, no separate organization entity needed), #2 (canonical MCP = `api/mcp.js`), #3 (TypeScript scope = new domain-service code only). Prompt 2 (shared domain contracts) can now proceed on that basis.

**Stage 1 — Shared contracts on the resolved model (Prompt 2):** Formalize the entities that already exist adjacent-shape (Workspace = `intelligence_profiles`, Workspace membership = `intelligence_profile_members`, Competitor, Market Signal, Strategic Brief, Approval) rather than inventing new ones. No separate Organisation entity — `profiles` (the account) is the billing/ownership boundary per Decision #1. Add the genuinely missing ones (Offer, Campaign Concept, Creative Specification, Campaign Learning).

**Stage 2 — BusinessBrain approval workflow (Prompt 3, narrow scope):** The data model and versioning already exist; the only real net-new piece is the propose/approve/reject gate around enrichment writes. This is a small, well-bounded addition to existing code, not a rebuild.

**Stage 3 — Evidence discipline + cloud persistence for Radar/Pulse (Prompt 5, narrow scope):** Add source/confidence/timestamp fields and a Supabase-backed store (mirroring `business-brain-cloud.js`'s pattern exactly) before building new analysis operations on top of ungrounded data.

**Stage 4 — Customer Voice Intelligence foundation (Prompt 4):** Genuinely new; build the connector interface and ingestion/analysis pipeline against Stage 1's contracts.

**Stage 5 — Strategic Brief depth audit + Campaign Architect (Prompt 6):** Read `StrategicBrief` and `strategic-brief.html` in full first (currently UNCERTAIN) — likely less net-new work than Campaign Architect, which appears to be entirely new.

**Stage 6 — Creative Intelligence scoring + lineage (Prompt 7, narrow scope):** The renderer is already strong; add scoring and the full lineage chain on top of what exists rather than rebuilding rendering.

**Stage 7 — Content/SEO/Landing (Prompt 8):** Audit `web/seo/*` in full first (likely the most mature area per prior review) before assuming what needs building; Landing Page Optimisation is the clearest net-new gap.

**Stage 8 — Analytics/Experiments/Marketing Memory (Prompt 9):** Marketing Memory is entirely new and high-value (prevents repeated bad recommendations) — worth prioritizing early despite being late in the prompt sequence.

**Stage 9 — CRM/Outreach/Listening/Reputation (Prompt 10):** CRM foundation is real and current; Listening/Reputation are new; compliance metadata (consent, suppression) should land before any Outreach send-capability is ever added.

**Stage 10 — MCP Gateway (Prompt 11):** Only after Stage 1's contracts exist to hang tools off of, and Decision #2 is resolved.

**Stage 11 — Claude orchestration (Prompt 12):** Depends on Stage 10's tool definitions existing (per the "do not duplicate marketing logic" rule — orchestration and MCP gateway must call the same domain services).

**Stage 12 — OAuth (Prompt 13):** Depends on Stage 10 (there must be a real tool catalogue to scope access to).

**Stage 13 — Central Approval/Compliance service (Prompt 14):** Generalize the two existing bespoke approval patterns (Stage 2's BusinessBrain gate, the existing `social_posts` review queue) into the shared service, rather than building a third pattern from nothing.
