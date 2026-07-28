---
'@getmunin/backend-core': minor
'@getmunin/db': patch
---

Slack outreach approvals now thread per campaign instead of posting one standalone message per draft: a parent message carries a live pending count (flipping to an all-handled banner at zero, with one parent per campaign per UTC day, so daily waves never land in a buried thread), each draft posts as a compact thread reply with a shorter body preview, and a new *View full draft* button opens the complete subject and body in a Slack modal so reviewing no longer requires the dashboard.
