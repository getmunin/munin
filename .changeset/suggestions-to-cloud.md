---
'@getmunin/backend-core': minor
'@getmunin/db': minor
'@getmunin/dashboard-pages': minor
---

Move suggestions feature out of OSS to a cloud-only Munin-vendor roadmap.

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

The replacement lives in the cloud overlay (`@munin-cloud/feedback` plus
`@munin-cloud/dashboard-feedback`). Voting is now per-org instead of
per-actor — one vote per `(suggestion_id, org_id)` so multiple
users/agents in the same customer org collectively contribute one vote.
The five MCP tool names are unchanged; admins/agents keep calling
`suggestion_search`, `suggestion_create`, etc., but they hit the cloud
schema.

**OSS users who relied on the per-org board:** the feature is gone. Build
your own roadmap using the existing CRM/CMS primitives or a third-party
tool. (No public OSS deployment uses it pre-this release.)
