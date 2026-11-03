---
'@getmunin/backend-core': minor
'@getmunin/dashboard-pages': patch
---

Email templates now know where they are used. `outreach_get_email_template` returns a `usage` block listing the broadcasts, the journey email steps (in the live version, the open draft, or an older version people are still running through) and the queued journey emails that render with the template; for the default template, `viaDefault` marks the ones that name no template of their own. `outreach_delete_email_template` refuses while any of those name the template, not only broadcasts, so deleting a template can no longer break a live journey's sends. Deleting the default stays allowed, since its users fall back to the built-in layout.

The empty journeys page now says plainly that an agent sets journeys up over MCP.
