---
'@getmunin/backend-core': patch
'@getmunin/dashboard-pages': patch
---

Slack installs and Slack user mapping are tightened so another organization can no longer attach your Slack workspace to itself, or act as one of your members from a shared channel.

- `slack_get_install_url` (and the dashboard's Connect Slack button) now hand out a Munin link instead of a Slack authorize link. It only continues to Slack in a browser signed in to Munin as an owner or admin of the organization the link was made for, and the install must come back to that same browser and person. Each approval round trip completes at most once, and the link expires after 10 minutes. Previously a link minted through MCP could be completed by anyone who opened it, so a workspace admin tricked into approving one connected their workspace to the wrong organization.
- The Integrations page now explains why an install did not go through (not signed in, not an owner or admin, link expired or already used, declined in Slack).
- Slack users are linked to members by profile email only when they are full members of the connected workspace. Guests, deactivated accounts and people from another workspace sharing a channel over Slack Connect are never matched by email; link a guest by hand with `slack_link_user` when needed.
- Replies and button clicks from a user whose home workspace is not the connected one are refused even when that Slack user is already linked, so links created before this change cannot be used from outside the workspace.
