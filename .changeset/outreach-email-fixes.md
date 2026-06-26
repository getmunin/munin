---
"@getmunin/backend-core": patch
---

fix(outreach): correct fresh-email subject, unsubscribe domain, and link rendering

- Only prepend `Re:` to outbound email subjects when the message is an actual reply (the conversation has prior messages or an `In-Reply-To` header); fresh outreach sends keep their subject verbatim.
- Build the unsubscribe URL from the API domain (`MUNIN_API_URL`) like other transactional emails, instead of the MCP domain.
- Render the unsubscribe footer as a markdown link (`[Unsubscribe](…)`) so it shows as an "Unsubscribe" link in the HTML email instead of a full URL.
