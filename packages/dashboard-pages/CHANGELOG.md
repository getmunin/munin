# @getmunin/dashboard-pages

## 0.9.0

### Minor Changes

- 19466a0: Localize all dashboard pages and UI components with [next-intl](https://next-intl.dev). Ships English (`en`) and Norwegian Bokmål (`nb`) message catalogs that consumers extend in their own `messages/{locale}.json`.

  **Breaking-ish (pre-1.0 minor):**
  - `next-intl` is now a required peer dependency of `@getmunin/dashboard-pages`. Consumers must wrap their app in `<NextIntlClientProvider>` and configure `next-intl/plugin` in `next.config.mjs`.
  - `GoogleButton.label` (in `@getmunin/ui`) is now required. Pass a translated label rather than relying on the previous English default.

  **What's translated:** all `dashboard-pages` exports (`AgentsPage`, `ApiKeysPage`, `TeamPage`, `AuditLogPage`, `UsagePage`, `EndUsersPage`, `ExportPage`, `DashboardPage`, `AcceptInvitePage`, `OrgSwitcher`) plus error messages mapped from stable backend codes (e.g. `SIGNUP_DOMAIN_NOT_ALLOWED`, `SIGNUP_INVITE_ONLY`).

  **Backend changes (`@getmunin/backend`):** `auth.config.ts` now emits two distinct codes (`SIGNUP_DOMAIN_NOT_ALLOWED` and `SIGNUP_INVITE_ONLY`) instead of a single `SIGNUP_NOT_ALLOWED`. Email templates (password reset, verification) move into `email-templates.ts` keyed by locale, with a default driven by `MUNIN_DEFAULT_LOCALE` (`en` | `nb`).

### Patch Changes

- Updated dependencies [19466a0]
  - @getmunin/ui@0.9.0

## 0.8.0

### Patch Changes

- @getmunin/ui@0.8.0

## 0.7.0

### Patch Changes

- @getmunin/ui@0.7.0

## 0.6.0

### Minor Changes

- 1aaaa24: Move suggestions feature out of OSS to a private feature board.

  The `suggestions` feature was structured as a Canny-clone but its `appScope`
  enum (`kb | conv | crm | core`) was hardcoded to Munin's own modules — the
  real intent was a vendor roadmap, not per-org product feedback.

  **Breaking changes (pre-1.0; consumers must update at the same minor):**
  - Removed `SuggestionsModule` from `@getmunin/backend-core`.
  - Removed `suggestions` and `votes` tables from `@getmunin/db`'s published
    schema. New OSS migration `0002_drop_suggestions.sql` drops the tables on
    fresh and existing installs (idempotent).
  - Removed RLS policies for `suggestions` / `votes` from `rls.sql`.
  - Removed `SuggestionsPage`, `CommunityBoardPage`, and the
    `publicSuggestionsMetadata` / `publicSuggestionsRevalidate` exports from
    `@getmunin/dashboard-pages`.
  - Removed `/api/suggestions` and `/api/public/suggestions` REST routes.
  - Removed five MCP tools (`suggestion_*`) from the OSS surface.
  - Removed `suggestions` from the data-export bundle.

  The replacement lives in a downstream package. Voting is now per-org instead of
  per-actor — one vote per `(suggestion_id, org_id)` so multiple
  users/agents in the same customer org collectively contribute one vote.
  The five MCP tool names are unchanged; admins/agents keep calling
  `suggestion_search`, `suggestion_create`, etc., but they hit the cloud
  schema.

  **OSS users who relied on the per-org board:** the feature is gone. Build
  your own roadmap using the existing CRM/CMS primitives or a third-party
  tool. (No public OSS deployment uses it pre-this release.)

### Patch Changes

- @getmunin/ui@0.6.0

## 0.5.0

### Patch Changes

- @getmunin/ui@0.5.0

## 0.4.0

### Patch Changes

- @getmunin/ui@0.4.0

## 0.3.1

### Patch Changes

- fe8fd21: TenancyInterceptor: bypass RLS for `actor.type === 'partner'`.

  Partner actors (in a downstream package) operate across multiple orgs they
  provisioned. Their controllers filter manually by `partner_id`. OSS
  never produces `'partner'` actors, so this branch is dead code there.

- Updated dependencies [fe8fd21]
  - @getmunin/ui@0.3.1

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
  - @getmunin/ui@0.3.0

## 0.2.0

### Minor Changes

- f3abef4: Add cross-org switcher endpoint + UI.
  - New `GET /api/orgs/me/memberships` — list every org the caller is a member of (id, name, slug, role, isDefault).
  - New `PATCH /api/orgs/me/memberships/active` — flip `is_default` so the next session-cookie request resolves to the chosen org.
  - New `<OrgSwitcher />` component in `@getmunin/dashboard-pages` that wraps both endpoints. Cloud's dashboard layout renders it in the header.

  OSS (single-tenant) installs see exactly one membership and don't render a switcher.

### Patch Changes

- Updated dependencies [f3abef4]
  - @getmunin/ui@0.2.0
