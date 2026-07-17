# Permissions

Human-readable version of `domain/src/entities/role.ts`. **These two must be kept in sync** — if you change one, change the other in the same commit.

## 1. Two separate, orthogonal role systems

Audema has two roles that answer two different questions, and this program keeps them separate rather than collapsing them into one:

| | Question it answers | Values | Live source |
|---|---|---|---|
| **AccountRole** | "What can this person do to the *platform*?" | `user`, `admin`, `super_admin` | `profiles.role` (`database/admin-setup.sql`) |
| **WorkspaceRole** | "What can this person do inside *this specific workspace*?" | `owner`, `editor` | `intelligence_profile_members.role` (`supabase-intelligence-profiles.sql`) |

**An account-wide `admin` does not automatically get access to every workspace's BusinessBrain, campaigns, or creative assets.** Platform administration (`api/admin-users.js`'s user management) and workspace content access are deliberately kept separate — an admin still needs a real `WorkspaceMembership` to read a specific workspace's content, exactly like any other user. `ACCOUNT_ROLE_PLATFORM_PERMISSIONS` in `role.ts` exists only to describe platform-management capability (`platform:manage_users`, `platform:manage_admins`); it must never be used as a bypass for workspace-scoped reads/writes. See `domain/src/workspaceIsolation.ts` for the enforcement point this rule depends on.

## 2. Workspace role → permission table

`owner` is a strict superset of `editor` — every permission `editor` has, `owner` also has, plus the write/publish/send actions that follow.

| Permission | editor | owner |
|---|:---:|:---:|
| `businessbrain:read` | ✅ | ✅ |
| `businessbrain:write` | | ✅ |
| `competitors:read` | ✅ | ✅ |
| `competitors:write` | | ✅ |
| `market:read` | ✅ | ✅ |
| `market:write` | | ✅ |
| `strategy:read` | ✅ | ✅ |
| `strategy:write` | ✅ | ✅ |
| `creative:read` | ✅ | ✅ |
| `creative:generate` | ✅ | ✅ |
| `content:generate` | ✅ | ✅ |
| `analytics:read` | ✅ | ✅ |
| `campaigns:read` | ✅ | ✅ |
| `campaigns:draft` | ✅ | ✅ |
| `campaigns:publish` | | ✅ |
| `crm:read` | ✅ | ✅ |
| `crm:write` | | ✅ |
| `outreach:draft` | ✅ | ✅ |
| `outreach:send` | | ✅ |
| `assets:read` | ✅ | ✅ |
| `assets:write` | | ✅ |

**Design rule this table encodes:** an editor can *draft* and *propose* almost anything (strategy, creative, content, campaign drafts, outreach drafts) but cannot *publish*, *send*, or *irreversibly write* the highest-consequence actions (publishing a campaign, sending outreach, writing to BusinessBrain/competitors/market data directly, CRM writes). That boundary is deliberate: it's the same "propose vs. approve" split this program's `ApprovalState` enum already encodes at the data-model level (`DATA_MODEL.md` §6) — `editor` proposes, `owner` (or an approval workflow `owner` participates in) approves.

## 3. One permission vocabulary, not two

`domain/src/enums.ts`'s `PermissionSchema` is the single vocabulary used for:
1. Internal `WorkspaceRole` → permission mapping (this document, §2).
2. Prompt 13's external OAuth scopes (`businessbrain:read`, `campaigns:publish`, etc.) — when a customer connects an external Claude client to Audema's MCP gateway, the scopes they grant are literally this same enum, not a parallel list that could drift out of sync with internal permissions.

This means a scope-validation check for an MCP tool call and a workspace-role permission check for an internal UI action can share one `hasPermission()`-style function later, rather than two independently-maintained authorization systems.

## 4. What this program does not decide

- **Plan-based feature gating** (e.g. does the `free` plan get `creative:generate`?) is a separate, product-level decision layered on top of this table, not encoded here — this document is about *role* → *permission within a workspace the account already has access to*, not billing entitlement.
- **Consequential-action approval requirements** (which permissions additionally require an `Approval` record before executing, per Prompt 14) are not enumerated here — that's Prompt 14's Approval service scope, built on top of `ApprovalSchema` (`DATA_MODEL.md` §6).
