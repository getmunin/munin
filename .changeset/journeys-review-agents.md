---
'@getmunin/backend-core': patch
---

Journey agent-layer fixes from review: earned auto now counts only agent drafts written from the step's current brief, so a step cannot inherit approvals from fixed text or an older brief; customer inputs in agent prompts are fenced as data, and free-form event properties and run context lose email addresses and phone numbers; an agent's answer and the step's timeout can no longer both land; save-as-template replaces whole string values only, never keys or numbers; enrich skips empty values and refuses keys Munin reads itself such as `timezone`; and a draft journey no longer takes over its outreach campaign — only a live or paused one does.
