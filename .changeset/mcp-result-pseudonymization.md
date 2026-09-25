---
'@getmunin/mcp-toolkit': minor
'@getmunin/backend-core': minor
'@getmunin/types': minor
---

Pseudonymize personal data in MCP tool results for external callers. Every result an OAuth connector such as claude.ai receives now has known contacts replaced by a stable `[Contact …]` token (with a matching `contact-…@pseudonym.invalid` address and `[Phone …]`), and unknown names, emails, phone numbers, national IDs, bank accounts and card numbers masked. Results carry `_meta["munin/pii"]` with the coverage state and the detection layers that ran, and a short notice for the model. If pseudonymization fails, the result is withheld rather than returned raw.

The org's own agent runner keeps raw data, as do self-service callers acting on their own records and any credential holding the new `pii:raw` scope — which includes API keys created with `*`. Bulk exports built for migrations (`conv_export`, `crm_export`, `kb_export`, `cms_export`, `outreach_export`, `analytics_export_events`) are refused on a pseudonymized connection.

`@getmunin/mcp-toolkit` gains the `dataFilter` dispatch hook and the `rawDataOnly` tool flag that make this possible.
