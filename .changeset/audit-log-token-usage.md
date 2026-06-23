---
'@getmunin/backend-core': minor
---

Show AI token usage per operation in the audit log. The `audit_log` table gains a
`total_tokens` column, populated for token-spending operations — curator/background jobs
(skills, web import) via the acknowledge call, and chat/conversation agent replies — and
left blank for everything else. The audit-log API and dashboard page now expose a Tokens
column.
