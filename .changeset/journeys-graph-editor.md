---
'@getmunin/dashboard-pages': minor
'@getmunin/backend-core': minor
---

A person can now edit a journey draft in the dashboard. "Edit draft" on the journey's graph tab opens the editor:

- **Select a step in the graph** to change its label, text, subject, brief, approval mode, wait duration or awaited event, and where each edge leads.
- **Advanced (JSON)** edits any field of the step.
- **Add a step** of any common kind after the selected step. It takes over the selected step's `next`, so it is inserted between the two steps.
- **Remove a step** after a confirmation.

Every save is checked against the version the editor last loaded. If an agent or another person changed the draft in the meantime, the save is refused with a translated message and the page reloads, so nobody's edits are overwritten. Steps with validation errors are outlined in the graph and listed under it.

The layout stays automatic, and publishing still goes through the publish dialog. The `build-journey` skill tells agents that people may edit the same draft.
