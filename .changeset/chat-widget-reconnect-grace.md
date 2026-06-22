---
"@getmunin/chat-widget": patch
---

Chat widget: defer the "Reconnecting…" status bar by a short grace period (1.5s) so a quick websocket reconnect no longer flashes the bar and shifts the layout. The bar now appears only if the connection stays down past the grace window, matching the admin dashboard's disconnect banner.
