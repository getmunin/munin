---
'@getmunin/backend-core': patch
'@getmunin/dashboard-pages': patch
'@getmunin/core': patch
---

First-run onboarding now shows the MCP endpoint the running server reports, instead of the one baked into the client bundle at build time.

`NEXT_PUBLIC_MCP_URL` is read inside `'use client'` components, so its value is inlined when the Next app is compiled — not when the container starts. A deployment that sets the variable only as a runtime container env var (which is how the cloud stack passes it) therefore shipped the local fallback, and every operator opening a fresh dashboard in production was told to point their agent at `http://localhost:3001/mcp`.

`/v1/overview/setup` now carries `mcpUrl` (the backend's own `mcpResourceBase()`, resolved per request), the setup snapshot threads it through to `SetupSnapshot.mcpUrl`, and the first-run overview and review scenes prefer it, falling back to the build-time constant only when the endpoint could not be read.
