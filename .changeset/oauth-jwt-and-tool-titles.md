---
'@getmunin/core': minor
---

OAuth bearer-token verification overhaul + MCP tool/skill title prefixes.

**JWT access tokens.** Better Auth issues a signed JWT (not an opaque token) whenever the token request carries a `resource` indicator and the JWT plugin is enabled — and JWTs are **never** written to `oauth_access_token`; only the refresh token is. `CredentialResolver.resolveBearerToken` now detects the JWT shape, verifies it locally against the JWKS stored in the `jwks` table (per-`kid` in-memory cache), checks the issuer + audience, and builds an `ActorIdentity` from the `sub`, `scope`, and the user's default org membership. claude.ai web's MCP connector now resolves on the first `/mcp` call instead of 401-ing.

**Audience tolerance.** External MCP clients normalize the resource indicator inconsistently — claude.ai sends `https://<host>/` even when our metadata advertises `https://<host>/mcp`. JWT audience is now matched against the canonical URL plus its trailing-slash, bare-origin, and origin-with-slash variants, so the same backend works for clients that drop the path or fiddle with the slash. The same variant set is applied to Better Auth's `validAudiences` config (`apps/backend/src/auth/auth.config.ts`) so the `/auth/oauth2/token` exchange accepts the same shapes.

**Opaque-token hash fallback retained.** For installs that disable the JWT plugin (`disableJwtPlugin: true`), the opaque-token path still looks up `oauth_access_token.token` by `SHA-256(token)` (base64url), matching Better Auth's default `storeTokens: "hashed"`. Previously we compared the raw bearer against the column, which always missed.

**MCP tool/skill titles get module prefixes.** Every `@McpTool({ title })` and every `skill://*` frontmatter title now starts with the module label (`KB:`, `Conv:`, `CRM:`, `CMS:`, `Outreach:`, `Web:`, `Playbook:`). In claude.ai's alphabetical tool picker, all KB tools cluster together, all CRM tools cluster together, etc. Duplicate module words were stripped from the body when the prefix made them redundant ("Read CRM segment" → "CRM: Read segment"). Internal tool *names* (`kb_*`, `crm_*`, …) and skill URIs are unchanged — only the user-facing display titles moved.

**Internal refactor.** Split JWT-only logic (JWKS load, key cache, audience variants, JWT verification) out of `credentials.ts` into a sibling `oauth-jwt.ts`. The `CredentialResolver` class stays the public entry point. Exports `oauthMcpResourceAudience` and `deriveAudiencesFromScopes` so the JWT path can reuse them.

**Side-quests in the same PR.** OSS + cloud sign-in/sign-up pages resume the OAuth authorize flow after auth (so the MCP connector dance survives a fresh signup). The OAuth consent page reads `resp.url` (Better Auth's actual response field) in addition to `resp.redirect_uri`. AgentHostRunner resolves the singleton repository's literal id to a real `org_id` before opening its admin MCP client, so per-org RLS-bound writes don't hit a `kb_spaces_org_id_orgs_id_fk` FK violation.
