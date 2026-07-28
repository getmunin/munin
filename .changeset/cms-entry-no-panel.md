---
'@getmunin/backend-core': minor
'@getmunin/inspector-app': minor
'@getmunin/dashboard-pages': patch
---

CMS: `cms_get_entry` no longer renders an MCP Apps panel.

An entry is a document — long prose, blocks, images, under a user-defined schema — which is the worst fit for a fixed card in a chat transcript. The panel rendered every field stacked at full height and dumped `blocks` fields as raw JSON into a `<pre>` with no height cap, so reading one article produced a screen-and-a-half of transcript.

The decisive constraint is that the binding is per-tool, not per-call: hosts resolve `_meta.ui.resourceUri` from the tool definition, and neither the MCP Apps spec nor the ext-apps SDK defines a way to suppress rendering for a single call. So a panel that is mildly useful when reviewing one draft is unavoidably also rendered five times when an agent reads five entries for a research pass. There is no setting that makes it appear only when it helps.

Nothing moves out of reach. `cms_publish_entry` / `cms_unpublish_entry` / `cms_schedule_publish` were never app-only — unlike the outreach and CRM proposal actions — and they carry `destructiveHint: true`, so the human confirmation lives in the host's destructive-tool prompt rather than in a panel button. The tool result is unchanged: the full entry JSON was always in `content`, which is what the model reads.

The inspector app keeps its other six panel-bound tools (`cms_list_assets`, `kb_list_curation_candidates`, `crm_list_merge_proposals`, `outreach_list_proposals`, and the four analytics reads), all of which wrap bounded, actionable payloads. The entry view, its type guards, its `inspector.entry` translations, and its styles are deleted.
