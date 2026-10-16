---
'@getmunin/dashboard-pages': minor
'@getmunin/backend-core': minor
---

Publishing a social draft no longer dead-ends when you haven't connected your own account.

- In the review pane, Publish stays enabled for a reviewer without a connected LinkedIn or Facebook account. Clicking it (or ⌘↵) opens a "Connect LinkedIn to publish" prompt that starts the connection straight away; a hint under the post says what will happen. If the organisation has not set up its platform app yet, the prompt says so and links to Integrations.
- After authorizing, you land back on the draft you were reviewing — now showing "Publish as …" — instead of on the Integrations page. A Facebook connection still stops on Integrations to choose the Page, then returns to the draft.
- `POST /v1/social/accounts/authorize-url` takes an optional `returnTo`: a path on the dashboard, starting with a single `/`, with no fragment, at most 512 characters. It is signed into the OAuth state, and the callback redirects there with the usual `social=…` outcome parameters. Anything else is rejected with `social_invalid`.
