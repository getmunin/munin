---
'@getmunin/backend-core': minor
'@getmunin/dashboard-pages': minor
---

Let an org require pseudonymization for every external MCP connection. The Privacy settings page gains a "Personal data in MCP results" section: choose whether each connection decides when it is authorized, or whether every connection and API key is pseudonymized whatever it was granted. The setting is enforced on each tool call, and the consent screen states it instead of offering the raw-access box. The section also shows which detection layers are active, how far name detection has got, and lets an owner or admin look up who a token stands for.

When name detection is enabled and messages older than 24 hours (`MUNIN_PII_BACKLOG_ALERT_HOURS`) are still unchecked, a data-protection alert opens, and it resolves once the worker catches up.
