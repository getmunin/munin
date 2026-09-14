---
'@getmunin/dashboard-pages': patch
---

Add React component test infrastructure and pin the inbox composer state machine.

The package had 117 `.tsx` files and no way to render any of them: no `vitest.config.ts`, so
every test ran in vitest's default node environment. `vitest.config.ts` now declares two
projects — `logic` (`*.test.ts`, node) and `components` (`*.test.tsx`, happy-dom) — so the
existing pure-logic tests keep their environment while `@testing-library/react` renders
components in the other. `src/test/render.tsx` supplies `StrictMode` +
`NextIntlClientProvider` (real `en.json`) + `ConfirmDialogProvider`; `src/test/inbox-fixtures.ts`
supplies `ConversationDetail`, `QueueItemDto` and a full `QueueController` stub.

`conversation-pane.test.tsx` covers the composer's `suggestionId` / `dirty` / `reviewingDraft`
transitions by name. Two of them fail against the pre-fix component: reopening a conversation
whose detail is already cached delivered the selection change and the draft in one commit, and
the render-time `replyRef` mirror still held the previous conversation's text, so the seeding
effect judged the composer "touched" and left an empty box labelled "edited by you". That is a
commit-ordering defect — it needs two conversations, a real selection change and React's actual
effect ordering, which is why no pure-helper test could express it. StrictMode is on in the test
render so double-invoked effects surface this class of bug rather than hiding it.

`scripts/coverage.mjs` stops lending the package backend-core's vitest binary now that it owns one.
