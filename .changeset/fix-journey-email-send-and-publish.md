---
"@getmunin/backend-core": patch
---

Fix journey email sends, test sends and publishing for journeys with several auto email steps. The built package imported `email-template-render.ts` from `JourneyOutboxService` and `JourneySimulator`, so every journey email send and `journeys_send_test` failed with "Cannot find module". `tsc` does not rewrite `import()` paths inside decorated classes, so these are now static imports, and a lint rule blocks the pattern. Confirming a publish also always failed with `journeys_conflict` when two or more email steps were set to `approval: "auto"`, because the check compared the pinned templates in a key order that Postgres jsonb does not keep.
