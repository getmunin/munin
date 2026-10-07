---
'@getmunin/backend-core': patch
'@getmunin/dashboard-pages': patch
---

Placing a test call on a Threll voice channel whose threll has no outbound phone number now fails up front with `threll_no_outbound_number` and a translated explanation, instead of a bare `threll_400: 400` from Threll. Threll error responses also keep their detail when it isn't a plain `message` string — a message array, an `error` string or object, or an `errors` list — so other rejections are readable too.
