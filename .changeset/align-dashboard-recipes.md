---
'@getmunin/dashboard-pages': patch
---

Align the dashboard "agent recipes" starter list with the recipe guides shipped in `@getmunin/docs-pages`. The panel had drifted: it still listed **Content Marketer** (renamed to Conversation Distiller), **CRM Deduper**, and **KB Curator** (both dropped — the built-in curator now runs `skill://crm/clean-contact-data` and `skill://kb/review-content` automatically), and their "view prompt" links pointed at guide slugs that no longer exist (404).

Replaces those with current recipes (Lead Research, Lead Scoring, Conversation Distiller) alongside the still-valid Bug Triage, Renewal Watch, and SDR — keeping the list at 6, every `id` now resolving to a real `recipe-*` guide, and tool chips using current MCP tool names.
