---
'@getmunin/backend-core': patch
---

Validate analytics ingest payloads with Zod at the controller boundary. The pixel `@Query` params (`/v1/a/t/:key.gif`) and both beacon bodies (`/v1/a/t`, `/v1/a/v`) now run through `safeParse` schemas and reject any non-string field early instead of relying on hand-rolled `typeof` guards downstream. Closes the CodeQL "Type confusion through parameter tampering" alert raised on PR #360 and applies the same hardening to the matching beacon route. Matches the existing repo convention (see `api-keys.controller.ts`); no behavior change for valid clients.
