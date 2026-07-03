---
'@getmunin/inspector-app': patch
---

Stop MCP App hosts' rounded iframe clipping from slicing the panel border. The panel applies the host's style variables and rounds itself with `--border-radius-lg` where available; on `platform: 'mobile'` hosts (which draw their own rounded card around the embed) it drops its outer border entirely and lets the host frame it. Hosts that send no style tokens keep the square Munin look.
