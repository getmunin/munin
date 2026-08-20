---
'@getmunin/backend-core': patch
---

Keep the org association for an org-scoped authorization alive for as long as the request can still be submitted.

The association carrying the organization across the consent redirect expired after ten minutes, the same window the provider gives its signed authorize query. Leaving a consent screen open past that and reloading it swapped the organization label for the organization switcher: the association was gone, so `GET /v1/oauth/pending-org` correctly answered `pinned: false`. In the simple case the request had expired too, so this was misleading rather than harmful — approving it fails the provider's own signature check.

The two clocks come apart when an authorization takes more than one leg, because `redirectWithPromptCode` re-signs the query on each one while the association keeps the expiry from the first. Start signed out, take a few minutes over the login, and there is a window where the re-signed request is still valid but the association has expired — the screen offers a switcher, and approving binds the token to the default organization instead of the one in the URL.

The lifetime is now an hour and every recall pushes the expiry out again, so the association outlives the request it belongs to no matter how many legs it takes. An expired row is still never resurrected. Nothing about the keying changes: one organization per `code_challenge`, first-write-wins on the challenge-only key, the session-bound key preferred on recall, and membership still verified at consent. The cost is that a row keyed on an HMAC of a `code_challenge` can now linger up to an hour after a flow ends, readable only by a caller who presents that same challenge.
