---
'@getmunin/backend-core': patch
---

Journey emails, `journeys_simulate` render samples, `journeys_send_test` and the template hash taken when a journey is published load the email renderer again in a built deploy. They imported it with a dynamic `import('./email-template-render.ts')`, which the TypeScript build leaves as `.ts` (it rewrites the extension only in static imports), so the built server failed with "Cannot find module …/email-template-render.ts". They now use static imports, and a test refuses any dynamic import of a relative `.ts` path.
