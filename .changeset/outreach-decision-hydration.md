---
'@getmunin/backend-core': patch
---

Outreach proposal mutations (`outreach_approve_proposal`, `outreach_dismiss_proposal`, propose/update) now return the same joined `contact` and `campaign` summaries as `outreach_list_proposals`. Previously they returned `contact: null`, which made the inspector panel's row title fall back to the raw contact id after a decision.
