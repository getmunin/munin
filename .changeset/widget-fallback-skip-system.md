---
'@getmunin/backend-core': patch
---

The widget email fallback no longer emails a visitor because of a system message. A voice call that ended in the widget adds a "Call ended" line to the conversation, and a visitor who closed the tab before it rendered got that line emailed to them ten minutes later, with the call transcript quoted under it, although nobody had written to them. Only unread replies from a person or the AI agent now count as something to email about. System messages still appear in the quoted history when a real reply triggers the email.
