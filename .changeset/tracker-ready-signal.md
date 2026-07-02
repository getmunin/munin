---
'@getmunin/analytics-tracker': minor
'@getmunin/backend-core': patch
'@getmunin/dashboard-pages': patch
---

analytics-tracker: expose a readiness signal. Once the tracker's public API is installed it sets `window.mn.ready = true` and dispatches a `munin:ready` CustomEvent on `document`, so consumers can run identify round trips (or any `window.mn.*` call) as soon as the async script is ready — no polling, no dependence on the loader's own readiness callback:

```js
window.mn?.ready
  ? go()
  : document.addEventListener('munin:ready', go, { once: true });
```

`skill://analytics/identify-visitors`, the frontend-integration playbook, and the dashboard embed snippet now show this pattern.
