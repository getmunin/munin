---
'@getmunin/backend-core': patch
---

fix(deps): clear the three open Dependabot advisories and unblock the security updater

- **`js-yaml` 4.3.0 → 4.3.1** (GHSA / CVE-2026-59870, quadratic CPU consumption in `!!omap` resolution). The override key `js-yaml@>=4 <4.3.0` had already been climbed out of by the installed 4.3.0, so it was inert; it is now `>=4 <4.3.1` → `^4.3.1`. Reached only through dev tooling (`cosmiconfig`, and `read-yaml-file` under changesets).
- **`fast-uri` 3.1.4 → 3.1.5** (host confusion via a backslash authority introducer). Transitive via `ajv`; the previous `^3.1.4` floor sat exactly at the vulnerable version.
- **`hono` 4.12.32 → 4.13.1** (ReDoS in the CORS middleware via `Access-Control-Request-Headers`). Transitive and optional under `@modelcontextprotocol/node`, which we drive over the Express transport rather than the Hono one, so the CORS middleware is never mounted.

This also fixes the failing Dependabot security-update job. `.github/dependabot.yml` ignored `js-yaml` with no version qualifier — every version, not just the pinned one — so the updater had nothing it was permitted to propose and aborted the whole run with `all_versions_ignored`, taking the other ecosystems' updates down with it. The rule's stated reason no longer held: it was added when changesets pinned js-yaml at v3 through `read-yaml-file@1`, and the existing `read-yaml-file@1` → `^2.1.0` override has since moved that consumer onto js-yaml 4. There is no v3 left in the tree, so the ignore is removed rather than narrowed.
