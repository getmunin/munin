---
'@getmunin/backend-core': patch
---

Bumped four transitively-pulled dependencies flagged by Dependabot: `fast-uri` to 3.1.4 (host confusion via backslash authority delimiter and failed IDN canonicalization), `linkify-it` to 5.0.2 (quadratic-complexity DoS in the `mailto:` validator), `hono` to 4.12.32 (per-request JSX context isolation, `cx()` escaping bypass, header de-duplication), and `sharp` to 0.35.3 (libvips 8.18.3, covering CVE-2026-33327/33328/35590/35591). The `hono` and `fast-uri` overrides already allowed the patched versions and only needed re-resolution; `linkify-it` was pinned at the now-vulnerable floor. `sharp` moves ahead of the `^0.34.5` that `next` still declares as an optional dependency.
