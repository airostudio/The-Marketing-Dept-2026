# Compliance System — Fresh Audit & Fixes
**Date:** 2026-07-30
**Supersedes:** `COMPLIANCE_GUARD_AUDIT.md` (2026-03-15) — that document's findings
are now stale; see the superseded-notice added to its top.

## Scope

The compliance system spans **three pages**, not one:

| Page | Role |
|---|---|
| `web/agents/compliance-agent.html` (SHIELD) | Reviews marketing **content** for brand safety/legal risk (FTC, GDPR, CCPA, HIPAA) |
| `web/agents/compliance-automation.html` (LOCK) | Generates a one-time **enterprise automation plan** (SOC 2, ISO 27001, GDPR, HIPAA, PCI DSS) via Claude |
| `web/intelligence/compliance-command.html` (SHIELD, Intelligence module) | **Stateful tracker** — evidence checklist, risk register, framework tabs, persisted in `localStorage`; also duplicates a content-review panel and an automation-plan generator inline |

## What the March audit got right, and what's since changed

The March audit correctly identified that `compliance-agent.html` had only
minimal Intelligence Layer integration and that no enterprise compliance
automation existed at all. **Both gaps have since been closed in the code**,
before this pass started:

- `compliance-agent.html` now calls `buildIndustryComplianceContext()`,
  `buildICPComplianceContext()`, `buildCompetitorMentionGuidelines()`,
  `buildBrandValuesEthicalCheck()`, `buildRegionalComplianceContext()` —
  genuinely wired into `runReview()`, not dead code — plus a strategic
  validation warning below 30% Intelligence Layer completeness, an enhanced
  system prompt covering FTC/GDPR/CCPA/HIPAA/industry frameworks, and saves
  to `AgentHistory`.
- `compliance-automation.html` was built to cover the enterprise automation
  gap: SOC 2 / ISO 27001 / GDPR / HIPAA / PCI DSS framework selection, a
  Claude-generated automation plan, Intelligence Layer context, `AgentHistory`
  save, `scotty-intake.js` wiring.
- `compliance-command.html` was built as a genuinely stateful tracker —
  real evidence-item checklists persisted to `localStorage`
  (`loadEvidence()`/`saveEvidence()`), a risk register, and per-framework
  tabs — the actual "ongoing tracking" piece the March audit's spec called for.

None of that is reflected in the March doc, which is why it's now marked
superseded rather than deleted.

## What this pass found and fixed

### 1. Two of Compliance Command's three AI features were completely broken (critical)

`web/intelligence/compliance-command.html`'s `runContentReview()` and
`generateAutomationPlan()` both called `ClaudeService.streamResponse()` with
**positional arguments** —
`streamResponse(userPrompt, systemPrompt, chunkCallback)` — but the real
signature (`web/js/claude-service.js`) takes a **single options object**:
`streamResponse({ systemPrompt, messages, onChunk, onDone, onError })`.
Destructuring a string as that object silently produces `messages: undefined`
→ `[]`, so every click of "Run Review" or "Generate Automation Plan" on this
page would have failed outright (the API rejects an empty `messages` array)
or silently produced nothing. **Fixed**: both calls now use the correct
object signature, with `onError` surfacing failures in the UI instead of
being swallowed, and `onDone` now saves the result to `AgentHistory`
(previously this page never wrote to history at all, unlike the other two).

### 2. `compliance-automation.html`'s Intelligence badge was misleading

`checkIntel()` only tested `if (window.IntelligenceEngine)` — true the
instant the script loads, regardless of whether BusinessBrain has any real
data. **Fixed** to match `compliance-agent.html`'s stricter check:
`getContextBundle()?.isReady`.

### 3. `compliance-automation.html` had no strategic validation warning

`compliance-agent.html` warns (once per session) when the Intelligence Layer
is under 30% complete, so the user knows they're getting a generic result.
`compliance-automation.html` had no equivalent. **Fixed**: added the same
`getIntelligenceCompleteness()` check and one-time `confirm()` warning before
generating a plan.

### 4. `compliance-automation` was a second-class citizen in Scotty routing

It was present in `AGENT_ROUTES` but:
- **missing from `AGENT_DESCRIPTIONS`** — invisible anywhere that map is listed
- **missing from `detectAgent()`'s regex** — natural-language requests like
  "help with SOC 2 evidence collection" always routed to plain `compliance`
  instead
- **missing a dedicated entry in `getAgentInlinePrompt()`** — any inline/
  orchestration call fell through to the generic fallback prompt, losing all
  framework-specific instruction
- **missing from `generateMissionPlan()`'s agent list** — auto-generated
  multi-agent missions could never select it

**Fixed**: added all four. `compliance-automation` is now fully reachable via
natural-language Scotty routing and orchestration, not just direct navigation.

### 5. Stale/wrong cross-links between the three surfaces

- `compliance-command.html`'s nav had an "Automation Plan" link pointing to
  `/intelligence/strategic-brief.html` — an unrelated page, almost certainly
  a copy-paste leftover, especially confusing since this page has its *own*
  inline automation-plan generator. **Fixed**: replaced with links to
  Compliance Guard and the full Compliance Automation agent page.
- `compliance-automation.html` had no explanation of how it relates to
  Compliance Command, unlike `compliance-agent.html` which already has a
  clarifying banner. **Fixed**: added an equivalent banner explaining
  "one-time plan" vs. "ongoing tracker," linking both directions.
- `web/workflow-guide.html` only listed SHIELD (Compliance Guard) in its
  13-agent walkthrough — no mention of LOCK (Enterprise Compliance
  Automation) at all. **Fixed**: added the missing card.

## Known remaining gap (not fixed — needs a product decision, not a patch)

**Three overlapping surfaces for the same subject matter is real
fragmentation**, not just a documentation gap. `compliance-command.html`
duplicates both `compliance-agent.html`'s content-review feature and
`compliance-automation.html`'s plan-generation feature inline, in addition to
its own real evidence/risk tracking. All three are now correctly cross-linked
and each explains what it's for, which resolves the *discoverability* problem
this pass was asked to fix — but the *duplication* itself (three separately
maintained copies of similar Claude prompts) is a design decision worth
revisiting: e.g. retiring `compliance-automation.html` as a standalone page in
favor of deep-linking straight into Compliance Command's inline generator, or
the reverse. Flagging for a deliberate choice rather than resolving unilaterally,
since it changes which page is canonical.

## Verification

- All five edited HTML files' inline `<script>` blocks parse cleanly
  (`node -e "new Function(...)"`).
- `web/js/scotty-orchestrator.js` passes `node -c`.
- The `ClaudeService.streamResponse()` call-signature fix was verified against
  the actual function signature in `web/js/claude-service.js:29`.
