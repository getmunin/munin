---
'@getmunin/inspector-app': patch
---

Adopt the host's corner radius so the panel border follows the iframe clip. MCP App hosts (claude.ai mobile in particular) clip the embed with rounded corners, which sliced the panel's square 1px border off at the corners. The panel now applies the host's style variables and rounds itself with `--border-radius-lg`, falling back to square corners on hosts that don't send style tokens.
