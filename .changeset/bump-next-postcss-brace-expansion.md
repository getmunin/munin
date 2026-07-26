---
'@getmunin/backend-core': patch
---

Bumped three more dependencies flagged by Dependabot: `next` to 16.2.12 (nine advisories fixed in 16.2.11 — SSRF in Server Actions on custom servers and in rewrites, App Router DoS via Server Actions, middleware bypass with Turbopack and a single locale, image-optimization DoS via SVG, response-body cache confusion, unbounded Edge Server Action payloads, and disclosure of internal Server Function endpoints), `postcss` to 8.5.23 (path traversal in previous-source-map auto-loading), and `brace-expansion` to 5.0.8 (DoS via unbounded expansion length). Declared ranges moved to the patched floor; `next` peer ranges stay at `^16.0.0` so consumers are not narrowed.
