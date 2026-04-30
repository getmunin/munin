# @getmunin/mcp-toolkit

## 0.7.0

### Minor Changes

- 93c385a: Publish runbooks to connecting MCP agents via the spec's standard primitives.
  - `@getmunin/mcp-toolkit` adds `RunbookRegistry` (parallel to `McpToolRegistry`) and extends `createMcpServer` with optional `runbooks` and `instructions` fields. When runbooks are provided the server declares the `resources` capability and registers `resources/list` + `resources/read` handlers, audience-filtered the same way tools are.
  - `@getmunin/backend-core` ships a markdown runbook loader that scans `src/modules/**/runbooks/*.md` at boot, parses YAML frontmatter, and registers each into a `RunbookRegistry`. The MCP controller passes the registry plus an auto-generated `instructions` string into every per-request server.
  - Five starter runbooks: email-channel-setup, widget-onboarding, handoff-from-ai-agent, customer-onboarding, kb/import-from-google-docs.
  - Build step copies `*.md` from `src` to `dist` so runbooks ship inside the published tarball.

  Result: agents connecting to `/mcp` get a short orientation in their `initialize` response (`instructions` field) and can discover detailed workflow guides via `resources/list`.

### Patch Changes

- @getmunin/core@0.7.0
- @getmunin/types@0.7.0

## 0.6.0

### Patch Changes

- @getmunin/core@0.6.0
- @getmunin/types@0.6.0

## 0.5.0

### Patch Changes

- Updated dependencies [6506b10]
  - @getmunin/core@0.5.0
  - @getmunin/types@0.5.0

## 0.4.0

### Patch Changes

- @getmunin/core@0.4.0
- @getmunin/types@0.4.0

## 0.3.1

### Patch Changes

- fe8fd21: TenancyInterceptor: bypass RLS for `actor.type === 'partner'`.

  Partner actors (in a downstream package) operate across multiple orgs they
  provisioned. Their controllers filter manually by `partner_id`. OSS
  never produces `'partner'` actors, so this branch is dead code there.

- Updated dependencies [fe8fd21]
  - @getmunin/core@0.3.1
  - @getmunin/types@0.3.1

## 0.3.0

### Minor Changes

- 5c140d5: Add credential-resolver extension point to AuthGuard.

  `AuthGuard` now accepts an optional injected `AdditionalCredentialResolver[]`
  via the `ADDITIONAL_CREDENTIAL_RESOLVERS` token. When OSS's `resolveApiKey`
  returns null, each additional resolver gets a shot at the raw key.
  Downstream packages plug in via this token to recognize their own key
  kinds without touching OSS code.

  `looksLikeApiKey` regex broadened from `mn_(admin|dlg)_*` to `mn_[a-z]+_*`
  so additional kinds reach the resolver chain.

### Patch Changes

- Updated dependencies [5c140d5]
  - @getmunin/core@0.3.0
  - @getmunin/types@0.3.0

## 0.2.0

### Minor Changes

- f3abef4: Add cross-org switcher endpoint + UI.
  - New `GET /api/orgs/me/memberships` — list every org the caller is a member of (id, name, slug, role, isDefault).
  - New `PATCH /api/orgs/me/memberships/active` — flip `is_default` so the next session-cookie request resolves to the chosen org.
  - New `<OrgSwitcher />` component in `@getmunin/dashboard-pages` that wraps both endpoints. Cloud's dashboard layout renders it in the header.

  OSS (single-tenant) installs see exactly one membership and don't render a switcher.

### Patch Changes

- Updated dependencies [f3abef4]
  - @getmunin/core@0.2.0
  - @getmunin/types@0.2.0
