---
'@getmunin/dashboard-pages': minor
'@getmunin/backend-core': minor
---

Connect a Facebook Page from the dashboard, and pick which Page it posts as.

Facebook appears on the Integrations page beside LinkedIn. Authorising comes back to a
picker listing the Pages that account administers — only the ones the person may actually
publish to — and the Page is bound when one is chosen. Connecting again is how you move to
another Page.

The setup dialog's steps were written for LinkedIn's console and are now per-platform: the
products to add, the note under them, the secret's placeholder, and the line about whose
name a post goes out under, which is the opposite answer on the two platforms. Facebook's
copy says the thing worth knowing before anyone gets far: until Meta reviews the app, only
people holding a role on it can connect.

`skill://social/publish-a-reviewed-post` and `skill://social/attach-media-to-a-post` cover
the differences an agent will hit — that a Facebook post is signed by the Page rather than
the caller (`authorKind: org_page`), that a photo post and a link preview card are mutually
exclusive so `linkPlacement: comment` is usually the better answer there, that the body
ceilings are 3,000 against 63,206, and that Facebook takes images only. One correction of
emphasis for agents: a lapsed LinkedIn grant is routine and expected, while a refused
Facebook Page token is not — that token does not expire, so a refusal means the access was
withdrawn.
