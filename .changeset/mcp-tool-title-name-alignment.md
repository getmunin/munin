---
'@getmunin/backend-core': patch
---

Align three MCP tool titles with their function names, so the display label tracks the operation the tool actually performs:

- `cms_upload_asset_from_base64`: *"Upload small asset inline (base64)"* → *"Upload asset from base64"*. Matches the `from_url` / `from_base64` taxonomy and stops the title from making a separate size claim from what the description already documents.
- `outreach_propose_initial`: *"Propose an initial draft"* → *"Propose initial"*. Drops the wording the function name doesn't carry.
- `outreach_propose_reply`: *"Propose an reply draft"* → *"Propose reply"*. Same cleanup; also fixes the *"an reply"* grammar slip.

No tool name / arguments / behavior changes.
