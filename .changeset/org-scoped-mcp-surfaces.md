---
'@getmunin/backend-core': minor
'@getmunin/core': minor
---

Let any registered MCP resource be addressed per organization, not just the shared endpoint.

Org scoping was written for one path. `/mcp/o/<orgId>` was a literal prefix, the resource identifier was built from an org id alone, and the association carried an org with no record of what it was asked for — so a second MCP endpoint registered beside `/mcp` could only ever be reached at its bare path, and every connection to it bound to whichever membership was `isDefault`. A user in several organizations could hold exactly one connection to it.

An org now hangs off any resource path below `/mcp`: `<resourcePath>/o/<orgId>`. The pieces that were hardcoded to the shared endpoint are now parameterised by the resource:

- Paths and resource identifiers are parsed and built from a `{ basePath, orgId }` pair, and the request scope carries the base path so later steps know which resource the org was requested for.
- The protected-resource document for `<surface>/o/<orgId>` advertises that URL as its own resource identifier, with the surface's own scopes and name plus the `mcp:org:<orgId>` marker, and 404s when no surface is registered at that path.
- Tokens narrow to the resource the request named — a surface's own identifier rather than the shared one — so the audience the provider validates matches what the surface accepts. The shared endpoint still narrows to the configured base resource, which is not necessarily origin plus `/mcp`.
- The association records the base path alongside the org, so the consent leg reconstructs the same resource. A row written before this change reads back as the shared endpoint, so associations in flight across a deploy still resolve.
- The guard enforces the org against the credential on a surface path exactly as on the shared one, accepts the surface, the org-scoped surface and the base resource as audiences there, refuses one organization's identifier on another's path, and challenges with the org-scoped document so a client re-authorizes into the right organization instead of looping on the surface root.
- A malformed org selector still 404s rather than falling through to default-organization behaviour, on surface paths as well.

Only paths below `/mcp` can be org-scoped; anything else is refused when building or parsing, so this cannot be used to org-scope an unrelated endpoint.
