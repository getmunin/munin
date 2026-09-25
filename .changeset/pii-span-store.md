---
'@getmunin/db': minor
---

Add the span store behind MCP pseudonymization: `pii_message_annotations` records which messages the annotation worker has processed and at which detector version, and `pii_spans` holds the person names it detected. Both are admin-only under RLS and cascade from `conv_messages`, so erasing a message erases what was learned from it.
