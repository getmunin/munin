---
"@getmunin/backend-core": patch
---

Fix journey email sends, test sends and publishing for journeys with several auto email steps. The built package imported `email-template-render.ts` from `JourneyOutboxService` and `JourneySimulator`, so every journey email send and `journeys_send_test` failed with "Cannot find module". `tsc` does not rewrite `import()` paths inside a class with class-level or constructor-parameter decorators, so these are now static imports, as is the one in the template hash check. A lint rule blocks the pattern, and the build output is now checked for relative TypeScript import paths before release. The email renderer loads `mjml` on first render rather than at startup. Confirming a publish also always failed with `journeys_conflict` when two or more email steps were set to `approval: "auto"`, because the check compared the pinned templates in a key order that Postgres jsonb does not keep.

Journey emails that failed while the import was broken (5.49.0 to 5.52.1) are not resent by this release: their proposals stay `failed` and their enrollments stay exited with `message_failed`. `journeys_list_enrollments` with `state: "exited"` lists who was affected, per journey.
