---
'@getmunin/backend-core': patch
'@getmunin/dashboard-pages': patch
---

Accepting an organization invitation now makes the invited org the user's default and pins it as the active org in the dashboard. Previously a user who already had another default membership — such as an org provisioned automatically at signup — landed back in that org after accepting, and was sent into setup instead of the org they had just joined.
