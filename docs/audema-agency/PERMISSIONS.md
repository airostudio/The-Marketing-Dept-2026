# Agency Edition — Permissions

Human-readable mirror of `domain/src/entities/agencyMember.ts`'s
`AGENCY_ROLE_PERMISSIONS` table. If the two ever disagree, the code is the
source of truth — update this file to match, not the other way around.

Permissions share the one colon-separated `Permission` vocabulary defined in
`domain/src/enums.ts` (`docs/audema-mcp/DECISIONS.md` #4) — the same names
used for workspace roles (`role.ts`) and, in future, MCP/OAuth scopes.

Unlike `WorkspaceRole` (`owner ⊇ editor ⊇ viewer`, a strict hierarchy), each
`AgencyRole` below is an **explicit, non-additive list** — the master prompt's
role descriptions have real carve-outs, not a clean seniority ladder. Do not
assume a "higher" role implies every permission of a "lower" one.

## Two separate isolation layers, not encoded as permissions

1. **Agency isolation** — one agency's client businesses are never visible to
   another agency (`assertAgencyScope` / `filterByAgency` in
   `domain/src/agencyIsolation.ts`).
2. **Per-client access** — within an agency, `owner` and `admin` can act on
   every client business (`AGENCY_WIDE_CLIENT_ACCESS_ROLES`); every other role
   needs an explicit `ClientMemberAccess` grant per client
   (`canAgencyMemberAccessClient`). This is orthogonal to the permission table
   below — a role can hold `campaigns:edit` and still be denied access to a
   specific client if no grant exists.

## Role permission table

| Permission | Owner | Administrator | Account Manager | Marketing Specialist | Analyst | Client Viewer |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| `agency:manage` | ✅ | | | | | |
| `billing:manage` | ✅ | | | | | |
| `members:manage` | ✅ | ✅ | | | | |
| `clients:create` | ✅ | ✅ | | | | |
| `clients:manage` | ✅ | ✅ | | | | |
| `clients:archive` | ✅ | | | | | |
| `campaigns:create` | ✅ | ✅ | ✅ | ✅ | | |
| `campaigns:edit` | ✅ | ✅ | ✅ | ✅ | | |
| `campaigns:draft` | ✅ | ✅ | ✅ | ✅ | | |
| `campaigns:approve` | ✅ | ✅ | ✅ | | | |
| `campaigns:publish` | ✅ | ✅ | ✅ | | | |
| `campaigns:read` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `analytics:read` | ✅ | ✅ | ✅ | | ✅ | ✅ |
| `reports:export` | ✅ | ✅ | | | ✅ | |
| `integrations:manage` | ✅ | ✅ | | | | |
| `businessbrain:read` | ✅ | ✅ | ✅ | ✅ | ✅ | |
| `businessbrain:write` | ✅ | ✅ | | | | |
| `competitors:read` | ✅ | ✅ | ✅ | ✅ | ✅ | |
| `competitors:write` | ✅ | ✅ | | | | |
| `market:read` | ✅ | ✅ | ✅ | ✅ | ✅ | |
| `market:write` | ✅ | ✅ | | | | |
| `strategy:read` | ✅ | ✅ | ✅ | ✅ | ✅ | |
| `strategy:write` | ✅ | ✅ | | | | |
| `creative:read` | ✅ | ✅ | ✅ | ✅ | | |
| `creative:generate` | ✅ | ✅ | ✅ | ✅ | | |
| `content:generate` | ✅ | ✅ | ✅ | ✅ | | |
| `crm:read` | ✅ | ✅ | ✅ | ✅ | | |
| `crm:write` | ✅ | ✅ | | | | |
| `outreach:draft` | ✅ | ✅ | ✅ | | | |
| `outreach:send` | ✅ | ✅ | | | | |
| `assets:read` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `assets:write` | ✅ | ✅ | ✅ | ✅ | | |

### Notable deliberate carve-outs (master prompt §3)

- **Administrator** cannot transfer ownership or cancel the agency account
  (`agency:manage`), cannot manage billing, and cannot archive a client
  business unless specifically authorised.
- **Account Manager** can approve and publish campaigns but cannot access
  agency billing, create/manage/archive clients, manage members, export
  reports, or manage integrations. Scope is per-assigned-client
  (`ClientMemberAccess`), not agency-wide.
- **Marketing Specialist** can create/edit/draft campaigns and generate
  content/creative but cannot approve or publish — approval sits with
  Account Manager and above.
- **Analyst** is read-only across campaigns/strategy/competitors/market and
  can export reports, but cannot create, edit, approve, or publish anything.
- **Client Viewer** holds almost no internal `Permission` — real client-facing
  capability (approve, comment, download) lives in the separate Client
  Approval Portal surface (master prompt §11), a narrower, purpose-built
  surface added in a later phase, not the internal app.

## Seat accounting note

`client_viewer` rows are the documented exception to "one AgencyMember = one
seat" (`docs/audema-agency/DECISIONS.md` #7, still open) — seat-counting
logic itself lives in `domain/src/billing/agencyPricing.ts` and is a later
phase; this permission table only defines what each role can *do*, not what
it costs.
