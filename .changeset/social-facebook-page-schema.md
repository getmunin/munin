---
'@getmunin/db': minor
---

Schema groundwork for publishing as a Facebook Page.

`facebook` joins `linkedin` in the platform check constraints on `social_post_drafts`,
`social_platform_apps` and `social_accounts`. Nothing writes it yet — the adapter and the
connect flow follow — but a draft is filed before anything can be published, so the drafts
table needed it too.

`social_pending_grants` is new, and exists because a Facebook authorization does not
resolve to an author the way a LinkedIn one does. LinkedIn hands back a token that is
already a person, so the OAuth callback can write the account row on the spot. Facebook
hands back a long-lived *user* token, which is only a key to the list of Pages that person
administers; which Page to post as is a human decision. So the callback parks the encrypted
owner token here and the dashboard asks. The Page access token is fetched live when the
choice is made, which is why no page credential is ever stored on this table. Rows live for
minutes and are deleted the moment a Page is chosen.

`social_accounts_org_platform_external_uq` becomes partial, applying only where
`author_kind = 'member'`. It was added so two colleagues could not both attach the same
LinkedIn profile and each believe they were posting as themselves. That reasoning holds for
a personal profile and inverts for a company Page, where several admins posting as the Page
is the normal arrangement — and the guarantee is unchanged for the case it was written for.
