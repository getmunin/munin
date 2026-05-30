---
'@getmunin/emails': patch
---

Add `react-dom` as a direct dependency of `@getmunin/emails`.

`@react-email/render` declares it as a peer (used internally for `renderToStaticMarkup`). The package's own tests passed because the workspace hoists `react-dom` into the root, but consumer Docker images that install only production deps for a single workspace target (cloud's `backend-cloud`) never pulled it in, so `render()` threw at runtime and BetterAuth swallowed the failure — end-user symptom: forgot-password / verify / delete-account / partner-claim emails silently dropped on prod after the 4.23.4 cutover.

Now declared explicitly so every consumer gets it transitively.
