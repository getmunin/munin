---
'@getmunin/dashboard-pages': patch
---

Format `date` and `datetime` fields in the read-only CMS entry drawer using the viewer's locale instead of printing the raw stored ISO string (e.g. `Jun 29, 2026, 12:00 PM` rather than `2026-06-29T12:00:00.000Z`), matching how the edit-mode date picker displays them.
