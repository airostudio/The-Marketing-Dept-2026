# Agency Edition — Decisions Log

Mirrors `docs/audema-mcp/DECISIONS.md`'s format. Status: 🟢 Decided · 🔴 Open (blocks a later phase).

---

### 1. 🟢 Revising `docs/audema-mcp/DECISIONS.md` #1: Agency is now a real entity

**Original decision:** no separate organization table; `intelligence_profiles` formalized as "Workspace" directly under a `profiles` account.

**Why revised:** seat-based Stripe billing cannot be represented by a text column (`profiles.plan`) — there's no field to hold a Stripe subscription ID, seat count, or billing period against. A subscription needs a row.

**Decided (project owner):** Add `Agency` as a new layer *above* `intelligence_profiles`. `intelligence_profiles` becomes "ClientBusiness" conceptually — same physical table, same columns, same existing behavior for every non-agency account — gaining an optional `agency_id` FK. `Agency` owns billing (`agency_subscriptions`), membership (`agency_members`), and invitations (`agency_invitations`). This is additive: nothing that already reads/writes `intelligence_profiles` needs to change, because `agency_id` is nullable and every existing row has it `NULL`.

---

### 2. 🟢 Stripe: build now, connect later

**Decided (project owner):** the pricing module (`domain/src/billing/agencyPricing.ts`), the `AgencySubscription` schema, and the webhook handler's shape are built and tested now against mocked responses. Real Stripe customer/subscription creation and live webhook wiring happen once Stripe is authorized in a session (via `claude mcp`/`/mcp`) or real price IDs are provided — neither is available in this non-interactive session per the standing tool-connection notice.

**Practical effect on Phase 1:** `AgencySubscription.stripeSubscriptionId` etc. are typed and nullable; nothing in Phase 1 calls the Stripe API.

---

### 3. 🟢 `ClientMemberAccess` is a new table, not an extension of `intelligence_profile_members`

**Why it matters:** the two look similar (both grant a user access to a business/profile) but answer different questions. `intelligence_profile_members` answers "does this user have owner/editor/viewer rights on this profile at all" — and must keep working exactly as-is for every non-agency account (a solo user sharing their BusinessBrain with a contractor, say). `client_member_access` answers a narrower, agency-specific question: "is this *agency member* (who already has a base `AgencyRole` granting a permission set) assigned to *this specific client business within their agency*." Conflating them would mean every non-agency sharing relationship suddenly has to reason about agency roles that don't apply to it.

**Decided:** kept separate. An `AgencyMember` who needs access to a `ClientBusiness` gets a `client_member_access` row; `intelligence_profile_members` is untouched and keeps meaning exactly what it means today.

---

### 4. 🟢 Permission naming convention: colon-separated, matching what's already shipped

**Why it matters:** the master prompt's own example (`"clients.create"`) uses dot separators; `domain/src/enums.ts` (already built, already in use) uses colons (`"campaigns:draft"`). Introducing a second convention in the same `Permission` type would be confusing and error-prone (easy to typo one style as the other).

**Decided:** every new permission added for this program uses the existing colon convention — `agency:manage`, `billing:manage`, `members:manage`, `clients:create`, `clients:manage`, `clients:archive`, `campaigns:create`, `campaigns:edit`, `campaigns:approve`, `reports:export`, `integrations:manage`. `analytics.view` from the master prompt's example is not duplicated — the existing `analytics:read` already means the same thing.

---

### 5. 🟢 `intelligence_profiles.status` defaults to `'active'` for every existing row

**Why it matters:** the Client Directory (master prompt §8) needs `active`/`paused`/`onboarding`/`archived` states. No status concept exists on this table today.

**Decided:** new nullable column with `DEFAULT 'active'` — every row that exists today silently becomes `'active'` with zero behavior change (nothing currently reads this column, so nothing currently branches on it). `archived_at` (already a pattern used on other tables in this repo, e.g. none directly but consistent with the master prompt's `ClientBusiness.archivedAt`) is added alongside it for when a client business is archived rather than deleted.

---

### 6. 🔴 Open: seat consumption for the agency owner

The master prompt states "the agency owner consumes one seat." This session's Phase 1 schema supports this (the owner gets an `agency_members` row like anyone else, with role `owner`), but the actual seat-counting logic (`SeatUsage`, invitation-reservation, upgrade-prompt-on-exhaustion) is UI/service logic for a later phase, not schema. Flagged here so Phase 2+ doesn't have to re-derive this rule from the spec.

---

### 7. 🔴 Open: `client_viewer` seat exemption

Per the master prompt, `Client Viewer` accounts do not consume agency seats "unless configured otherwise in the future." The schema (`agency_members.role` includes `client_viewer`, but seat-counting logic in a later phase must explicitly exclude `client_viewer` rows from `usedSeats`) — noted here so that exclusion isn't accidentally dropped when the seat-counting service is actually built.
