---
"@getmunin/dashboard-pages": patch
---

The inbox reply box now grows to fit the agent's draft as soon as a teammate claims the conversation. The draft was already seeded into the composer before the claim, so swapping the read-only preview for the editable box changed none of the values the auto-fit listened to, and the box stayed at its default four rows until the teammate typed.
