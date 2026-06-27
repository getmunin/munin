---
"@getmunin/dashboard-pages": patch
---

Share a single realtime WebSocket connection across all `useRealtime` callers instead of opening one socket per component. The dashboard previously held several concurrent connections (inbox, usage summary, recent conversations, system alerts, activity rail); they now multiplex over one connection, with each `event` frame routed to only the listeners subscribed to its channel. The `useRealtime` API is unchanged.
