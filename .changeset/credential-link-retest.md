---
'@getmunin/backend-core': patch
'@getmunin/dashboard-pages': patch
---

A credential link no longer burns when the connection test fails. The secret is still saved, but the link stays open until the test passes (or the link expires), and the page now says "Saved, but the connection test failed" instead of "Couldn't save". It offers **Test again**, which re-runs the test against the stored secret without retyping it (new `POST /v1/credentials/retest`), and **Enter different credentials**. This covers the common case of a freshly created mailbox or app password that takes a few minutes to become active.
