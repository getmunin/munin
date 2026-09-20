---
'@getmunin/backend-core': minor
---

Facebook joins LinkedIn as a social platform, posting as a company Page.

A Facebook authorization does not resolve to an author. LinkedIn hands back a token that is
already a person, so the callback writes the account row on the spot; Facebook hands back a
long-lived user token that is only a key to the list of Pages that person administers.
Which Page to post as is a human decision, so the callback parks the encrypted owner token
and the dashboard asks. `SocialOAuthAdapter` grew `listTargets` for adapters that need the
question asked, `identify` became optional for the same reason, and the callback redirects
to `?social=choose_target&pending=…` when a choice is outstanding. The Page list is read
live both when the choices are offered and when one is taken, so a Page the person lost
access to in between is refused (`social_target_unavailable`) rather than stored as a token
that will not work. Only Pages carrying the `CREATE_CONTENT` task are offered — the rest
could never publish. `GET /v1/social/accounts/pending/:id` and
`POST /v1/social/accounts/pending/:id/select` drive it; an authorization left open expires
after fifteen minutes and the expiry sweep purges it.

A Page access token derived from a long-lived user token does not expire, which the account
schema did not allow for: `accessTokenIsFresh` reads a null expiry as stale, so the token
would have been sent down the refresh path, found nothing to refresh with, and reported the
connection revoked on the first publish. Storing the 60-day user token as the refresh token
instead would have been worse in the other direction — the expiry sweep marks a row expired
on `refresh_token_expires_at`, so a working Page connection would go dark on day 60 and
raise a reconnect alert. So a Facebook row stores neither expiry nor refresh token, the
adapter declares `accessTokenNeverExpires`, and the token resolver returns it as is.
Recovery from a Page token the vendor invalidates is to reconnect, which is what those
cases require anyway.

Facebook's content model differs from LinkedIn's in ways the post has to respect. A photo
post carries no link preview, so a draft with both media and `linkPlacement: 'body'` gets
the URL in the message text and one with no media gets it as the `link` parameter, which is
what renders the preview card. Link-in-first-comment works as it does on LinkedIn. Images
only for now — video is a separate resumable upload — and the body limit is 63,206
characters.

`MUNIN_FACEBOOK_API_VERSION` overrides the pinned Graph version, the way
`MUNIN_LINKEDIN_API_VERSION` does, so a version rotation needs no release.

Two notes for operators. Each organisation enters its own Meta app client id and secret, as
with LinkedIn — and `pages_manage_posts` needs Meta App Review with Business Verification
before anyone but a person holding a role on the app can use it. And the scopes recorded on
a Facebook account are the ones the app requested rather than the ones granted, since the
Page listing does not report them; a permission declined in the dialog shows up as a
refusal at publish time.
