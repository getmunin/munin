---
"@getmunin/agent-runtime": minor
"@getmunin/agent-host": minor
"@getmunin/backend-core": minor
---

Website import now reaches client-rendered sites, prunes deleted pages, and titles pages correctly.

- The crawler follows client-side root redirects (`<meta http-equiv="refresh">` / `<link rel="canonical">`), so importing a bare domain that bounces to a locale path (e.g. `/` → `/en/`) discovers the real page tree instead of stalling on an empty shell.
- Title extraction prefers the first `<h1>` over a shared static `<title>`, so SPA routes no longer collapse to one repeated title.
- `kb_import_website` reconciles by default: after a healthy crawl, previously imported pages that are individually re-checked and confirmed gone (HTTP 404/410) are deleted from the knowledge base. Pass `reconcile: false` to import additively. Each imported document records its origin as a `source-url:<url>` tag for precise revalidation.
- `kb_list_documents` now returns each document's `slug`.
