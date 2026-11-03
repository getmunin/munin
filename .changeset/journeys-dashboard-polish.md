---
'@getmunin/dashboard-pages': patch
---

Fixes in the journey pages of the dashboard:

- **Company journeys.** The runs table is headed "Company" instead of "Person" when the runs follow companies.
- **Run states and exit reasons** are translated wherever they appear in the dashboard: the runs table, the step log and the report. Custom reasons from an exit step are still shown as written.
- **Publish dialog.** It now speaks of messages instead of emails, and names each auto step's channel.
- **Graph.** Edge labels sit on a small background, so the edges no longer run through them.
