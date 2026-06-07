---
'@getmunin/backend-core': patch
---

Add `skill://analytics/track-cms-views` — a dedicated playbook for the `_tracking` block that every CMS delivery response already ships. Explains how the pre-signed pixel/beacon tokens work, when to use the pixel vs. beacon embed, how to query `analytics_top_subjects` / `analytics_subject_engagement` with `subjectType='cms_entry'`, what to do (and not do) about pepper rotation, and how the flow differs from the website tracker. Also fixes the dead "Related" link in `skill://analytics/track-website-traffic` that previously pointed at `skill://cms/publish-entry` and reframes the website-vs-CMS distinction for headless deployments.
