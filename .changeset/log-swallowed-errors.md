---
"@getmunin/chat-widget": patch
"@getmunin/dashboard-pages": patch
---

Log previously swallowed errors in widget realtime, dashboard, and voice session paths. Empty `catch {}` blocks now emit `console.warn` for socket lifecycle/fetch failures and `console.debug` for listener-loop exceptions so issues surface during debugging instead of disappearing.
