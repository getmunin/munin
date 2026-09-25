---
'@getmunin/mcp-toolkit': minor
'@getmunin/backend-core': minor
---

Accept pseudonyms as tool input. On a pseudonymized MCP connection, `[Contact …]`, `contact-…@pseudonym.invalid` and `[Phone …]` in any tool argument are resolved to the real value before the tool runs, so an agent can look up the contact, orders or bookings behind a token, or draft a reply that reaches the customer with their real name. What comes back is pseudonymized again, and the audit log records the arguments as the caller sent them.
