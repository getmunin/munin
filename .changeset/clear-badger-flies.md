---
'@getmunin/dashboard-pages': patch
---

Surface the backend's 4xx error message in the dashboard's `SaveErrorStage` instead of always rendering the generic "couldn't reach the server" copy. The shared dialog was discarding `ApiError.message` even when the server returned an actionable validation error. `SaveErrorDetail` now carries an optional `message`, and the channel and tracker save flows populate it from the parsed server body for 4xx responses (5xx and network errors keep the original "try again" copy).

Also stops the widget channel create form from POSTing with an empty origin allowlist when the deployment requires one. Set `NEXT_PUBLIC_MUNIN_WIDGET_REQUIRE_ALLOWLIST=1` on the dashboard to mirror the existing backend `MUNIN_WIDGET_REQUIRE_ALLOWLIST` and the form will show an inline "at least one origin required" error before submit.
