---
'@getmunin/analytics-tracker': major
'@getmunin/chat-widget': major
'@getmunin/backend-core': patch
'@getmunin/docs-pages': patch
---

Namespace the browser API: `window.mn.analytics.*` and `window.mn.widget.*`

**Breaking.** Both bundles used to install onto `window.mn` — the tracker owned the root, the widget owned `mn.widget` *and* leaked `identify` onto the root. Since each also chained to whatever `identify` was already there, a page running both sent one hash to two verifiers that check different payloads against different secrets, so one always rejected. That failure was lopsided and the bad half was silent: the widget logs to the console, the tracker fires `sendBeacon` and never looks at the response, leaving only `identify.rejected: hmac_mismatch` in a server log an integrator can't see. An empty contact journey with no client-side error was the only symptom.

Each surface now owns a namespace, and the chaining is gone:

| Before | After |
|---|---|
| `window.mn.track(...)` | `window.mn.analytics.track(...)` |
| `window.mn.trackOnce(...)` | `window.mn.analytics.trackOnce(...)` |
| `window.mn.trackPageView()` | `window.mn.analytics.trackPageView()` |
| `window.mn.trackSearch(...)` | `window.mn.analytics.trackSearch(...)` |
| `window.mn.trackEntry(...)` | `window.mn.analytics.trackEntry(...)` |
| `window.mn.getVisitorId()` | `window.mn.analytics.getVisitorId()` |
| `window.mn.identify(...)` *(tracker)* | `window.mn.analytics.identify(...)` |
| `window.mn.identify(...)` *(widget)* | `window.mn.widget.identify(...)` |
| `window.mn.ready` | `window.mn.analytics.ready` |
| `munin:ready` event | `munin:analytics-ready` event |

`window.mn.widget.open/close/toggle/isOpen` are unchanged. The widget gains `ready` and a `munin:widget-ready` event, which it never had — needed now that `identify` lives behind a namespace that only exists once the widget mounts.

**Declarative embeds need no changes.** Every `data-*` attribute — `data-key`, `data-subject-type`, `data-mn-event`, `data-mn-once`, `data-external-id`, `data-user-hash`, `data-mn-entry-token` — works exactly as before. This is a JS-API change only, so a site that never calls `window.mn` from its own code is unaffected by the upgrade.

**Where the break lands is unusual.** Nothing fails at deploy: the backend starts, the API is unchanged, and the new bundles serve normally. What breaks is JavaScript on the *customer's* pages, the moment the upgraded bundle is served. Anyone calling `window.mn.*` from their own code updates the calls above; the failure is a loud `TypeError` rather than silent wrong behaviour.

**A rejected identify is no longer silent.** `POST /v1/a/identify` used to answer `204` for every outcome, and the tracker sent it with `sendBeacon` and never read the response — so a hash signed with the wrong secret produced no client-side signal at all, only a server log the integrator couldn't see. The endpoint now answers `400 identity_invalid` / `identity_secret_missing` / `identity_hash_mismatch` and `403 identity_origin_not_allowed`, the tracker posts with `fetch(..., { keepalive: true })` and logs a console warning naming the status. An unrecognized tracker key still answers `204`, so the endpoint doesn't confirm which keys exist. Direct callers of this endpoint that assumed "always 204" should expect real status codes now.
