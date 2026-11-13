---
'@getmunin/backend-core': patch
---

Journey emails, `journeys_simulate` render samples and `journeys_send_test` load the email renderer again in a built deploy. They imported it with a dynamic `import('./email-template-render.ts')` from inside a decorated class, where the TypeScript build leaves the `.ts` extension in place, so the built server failed with "Cannot find module …/email-template-render.ts". They now use static imports, and a lint rule refuses any dynamic import of a relative `.ts` path outside tests.

`journeys_simulate` and `journeys_send_test` now refuse an email step whose template has been deleted, the way a live send does, instead of rendering it in the built-in layout.
