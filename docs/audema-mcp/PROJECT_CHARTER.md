# Audema MCP — Project Charter

**Status:** Draft — audit phase only. No architectural changes have been made under this charter yet.
**Date:** 2026-07 (this audit)
**Scope of this document:** Prompt 1 of a 14-prompt program. This charter, and its four companion documents, describe what actually exists in the repository today, and stage a plan for what a 14-prompt program (BusinessBrain → Customer Voice → Competitive Radar/Market Pulse → Strategic Brief/Campaign Architect → Creative Intelligence → Content/SEO/Landing → Analytics/Experiments/Memory → CRM/Outreach/Listening/Reputation → MCP Gateway → Claude orchestration → OAuth → Approvals/Compliance) would require. **No code was refactored to produce this document**, per instruction.

## 1. What this program is

A staged plan to evolve the existing Audema / "The Marketing Dept 2026" platform toward a formal set of domain services (BusinessBrain, Competitive Radar, Market Pulse, Strategic Brief, Creative Intelligence, Content/SEO/Landing, Analytics/Experiments/Memory, CRM/Outreach/Listening/Reputation), fronted by a real MCP gateway and an in-app Claude orchestration layer ("Scotty"), with OAuth-scoped external Claude connectivity and a central approval/compliance system.

## 2. What this program is not (yet)

- It is **not** a decision to rewrite the platform in TypeScript, adopt an ORM, or introduce a multi-tenant "organization" data model. Those are real, high-impact decisions that the source prompts assume as background architecture; this repository does not have them today (see `CURRENT_ARCHITECTURE.md`). They are logged as open decisions in `DECISIONS.md`, not silently adopted.
- It is **not** a broad refactor. Prompt 1 (this document set) is audit-and-documentation only.

## 3. Why this matters

The platform already has real, working implementations of most of the concepts the 14-prompt program describes — under different names, in a different shape (vanilla JS classes + Supabase tables, not TypeScript domain services). `IMPLEMENTATION_STATUS.md` maps every requested capability to what exists today so later phases build *on* that work rather than duplicating it. Several serverless AI-proxy endpoints, an Intelligence Layer (BusinessBrain/Competitive Radar/Market Pulse/Strategic Brief), a working social-content pipeline with real publish adapters, and two independent MCP implementations already exist and are in various states of production use.

## 4. Guiding constraints carried into every later phase

1. **Search before building.** Every prompt in this program starts by checking whether the capability already exists under a different name.
2. **No silent architecture changes.** Adopting TypeScript, an ORM, a workspace/organization model, or a monorepo layout are treated as explicit decisions requiring sign-off (`DECISIONS.md`), not defaults.
3. **Security constraint carried from existing project conventions:** all API keys/secrets live exclusively in Vercel environment variables; nothing credential-related is ever stored or referenced client-side. Any MCP/OAuth work in later phases must preserve this.
4. **Approval-before-persistence** is already an established pattern in this codebase (see `business_brain_history`, `social_posts.status`) — later phases extend it, not invent it from scratch.

## 5. Deliverables of this phase (Prompt 1)

- `CURRENT_ARCHITECTURE.md` — what exists today, verified against the actual repository.
- `TARGET_ARCHITECTURE.md` — the requested target shape, mapped onto what would realistically have to change to get there.
- `DECISIONS.md` — open architectural questions that need explicit answers before Prompt 2 onward can safely proceed.
- `IMPLEMENTATION_STATUS.md` — capability-by-capability mapping of the full 14-prompt program against what already exists.

## 6. Immediate recommendation

Before starting Prompt 2 (shared domain contracts), get explicit sign-off on the open questions in `DECISIONS.md` — particularly **which backend is canonical** (see finding in `CURRENT_ARCHITECTURE.md` §2) and **whether TypeScript/ORM adoption is in scope**, since those two decisions determine almost everything about how Prompts 2–14 would actually be implemented in this repository.
