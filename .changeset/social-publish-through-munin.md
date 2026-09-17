---
'@getmunin/backend-core': minor
'@getmunin/dashboard-pages': minor
'@getmunin/db': minor
---

feat(social): publish a reviewed draft to LinkedIn from the reviewer's own account

Closes the gap the grant work left open. `w_member_social` was already being
requested and the draft table already carried `external_post_id`, `permalink` and
`last_error`, but nothing ever called LinkedIn: `approve` recorded
`published_externally`, the statuses `published` and `failed` were unreachable, and
the review pane told people to copy the text and post it by hand.

`SocialOAuthAdapter` gains an optional `publish`, implemented for LinkedIn against
`/rest/posts`. Optional rather than required for the same reason `SeoAdapter.submitUrls`
is: a platform Munin can draft for but not post to is a real thing, and the service
says so with `social_publish_unsupported` instead of faking it.

**A post is published from the account of whoever clicks publish** — never from the
draft's `suggestedUserId`, which stays a routing hint about who should pick the draft
up and confers nothing. A service key has no person behind it and is refused outright
with `social_publish_needs_person`, so an unattended agent cannot post under someone's
name no matter what scopes it holds.

Two ordering decisions, both the same lesson the grant work learned about markers and
rollbacks:

- The draft is locked with `SELECT … FOR UPDATE` across the platform call, so two
  reviewers clicking publish on the same draft cannot both post it.
- Both outcomes are written inside that root transaction, which commits before the
  error is raised. A failure that marked the draft inside the request transaction and
  then threw would roll its own marker back; a success written there would lose the
  record of a post that is already public if anything later in the request failed.

LinkedIn's commentary format reserves `\|{}@[]()<>#*_~`, so bodies are escaped before
they are sent — including the tracked share URL, whose `utm_` parameters carry reserved
underscores. The link is appended to the commentary rather than sent as an article,
because an article needs a title Munin does not have.

Adds `social:read` and `social:write` to `SUPPORTED_SCOPES`, which the social tools have
declared since they were written but no OAuth client could actually be granted.

Dashboard: the review pane's primary action becomes Publish (as the connected account's
name) with mark-as-posted kept beside it for the manual route, and Settings →
Integrations gains a Publishing accounts section — the org's LinkedIn app, the connect
and reconnect flow, and the redirect URL to paste into the developer portal. Until now
the expiry alert's "Reconnect account" link led to a page with nothing on it.

Adds `skill://social/publish-a-reviewed-post`, and corrects
`skill://social/route-a-post-to-a-person`, which told agents that nothing here publishes.

Adds `social_accounts.client_secret_set_at` (migration 0103) so the dashboard can
say when an org's OAuth client secret was stored without overstating it —
`updated_at` also moves when only the client id is edited. A secret is now kept
when a save omits it, so editing the client id no longer demands re-pasting a
secret LinkedIn shows only once.

The authorization callback carries the platform's own `error_description` back to
the dashboard. Without it every failure read as "the connection could not be
completed", including the one a real setup hits first: an app with Share on
LinkedIn but not Sign In with LinkedIn using OpenID Connect, where LinkedIn
answers `Scope "openid" is not authorized for your application`. Setup is now two
screens — the work done in LinkedIn's portal, then the credentials pasted back —
and names both products, since the first grants posting and the second grants the
identity every post is authored by.
