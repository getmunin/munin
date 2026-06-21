---
'@getmunin/docs-pages': patch
---

Fix the developer-portal docs on mobile. The decorative 320px sidebar-column fill (`.docs-body::before`) was painting an opaque stripe over the article on phones — `:has(.docs-side)` still matched the in-DOM sidebar even though it was `display:none` — leaving content clipped against the right edge. The stripe is now hidden below 880px, and each section's sidebar (REST endpoints, MCP tools, guides, skills) becomes a collapsible "Browse…" dropdown so in-section navigation works on mobile instead of disappearing.
