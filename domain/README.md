# audema-domain-contracts

Shared TypeScript types and runtime-validated (`zod`) schemas for all Audema marketing capabilities. See `docs/audema-mcp/DATA_MODEL.md` for the full write-up and `docs/audema-mcp/PERMISSIONS.md` for the Role/Permission model.

This is a self-contained package (own `package.json`/`tsconfig.json`), deliberately not wired into the existing `api/*.js` layer yet — per `docs/audema-mcp/DECISIONS.md` #3, TypeScript is scoped to new domain-service code only, and this is the first of it. Nothing in the existing plain-JS codebase was changed to produce this package.

## Setup

```sh
cd domain
npm install
```

## Commands

```sh
npm run build   # tsc -> dist/ (CommonJS + .d.ts), so a future plain-JS api/*.js file can require() it once wired up
npm test        # vitest — includes the required cross-workspace isolation proofs
```

## Layout

- `src/ids.ts` — branded UUID identifier types, one per entity.
- `src/enums.ts` — shared enums (approval states, roles, permissions/scopes, evidence types, platforms, creative formats).
- `src/base.ts` — composable mixins (`TimestampedSchema`, `WorkspaceScopedSchema`, `VersionedSchema`, `ApprovableSchema`, `EvidencedSchema`, `LineageSchema`, `ExtensionSchema`) every entity is built from.
- `src/workspaceIsolation.ts` — the enforcement contract (`assertWorkspaceScope`, `filterByWorkspace`, `WorkspaceScopedStore`) any real repository built on these types must satisfy.
- `src/entities/*.ts` — the 22 requested entities.
- `test/` — vitest specs, including `workspaceIsolation.test.ts` (proves one workspace cannot access another's records).

## Status

Contracts only (Prompt 2 of the Audema MCP program). No Supabase migrations, no repository implementations, no service operations yet — see `docs/audema-mcp/IMPLEMENTATION_STATUS.md` for what's next.
