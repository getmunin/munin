---
'@getmunin/backend-core': patch
---

Fix `journeys_send_test`, `journeys_simulate` and journey email delivery crashing with "Cannot find module …email-template-render.ts" in the built package. Two dynamic imports inside decorated classes kept their `.ts` extension after compilation; they are now static imports. CI also checks that every relative import in built output resolves.
