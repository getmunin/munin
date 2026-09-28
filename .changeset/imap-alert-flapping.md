---
'@getmunin/backend-core': patch
'@getmunin/db': patch
'@getmunin/dashboard-pages': patch
---

Stop an unstable mail server from flooding org owners with alert emails, and stop a short outage from switching an email channel off.

An inbound poll failure used to open a `channel_inbound` alert straight away, and the next successful poll resolved it. A server that kept dropping out therefore opened a brand-new alert, and sent a brand-new email to every owner, on each failure that followed a success: up to one every two minutes. A server that stayed down instead reached five failures in about five minutes and auto-deactivated the channel, which then stayed off after the server came back.

**Alerts and alert emails (every source).**

- An alert that comes back within six hours of resolving now reopens the same row and keeps counting (`MUNIN_ALERT_REOPEN_WINDOW_MS`, `0` turns this off). `org_alert.opened` fires again for it with `reopened: true` in the payload so webhook receivers and the dashboard banner see it flip back to open, but no second email is sent. A reopened alert also has its acknowledgement cleared.
- A new alert's owner email now waits for a grace period before its first send attempt. The worker already skipped alerts that had resolved by send time, so a blip that clears within the grace period emails nobody. The grace period is set per source in `NOTIFY_POLICY`, and sources without their own value use `MUNIN_ALERT_NOTIFY_GRACE_MS` (default ten minutes, `0` sends at once). `channel_inbound` uses `0`, because the poll worker already waits before opening a transient alert and a rejected login should reach the owner straight away.

**Inbound polling.**

- A poll adapter can classify a failure as `transient` or `permanent` through a new optional `classifyError` on its `poll` inbound mode. For IMAP, a rejected login or a server response of `AUTHENTICATIONFAILED`, `AUTHORIZATIONFAILED`, `EXPIRED` or `NONEXISTENT` is permanent. Everything else, including connection refusals, timeouts and DNS errors, is transient. An adapter that does not classify its errors gets transient.
- Every failing channel now backs off: after the second failure in a row the gap doubles, up to 15 minutes. Editing or reactivating the channel clears the backoff.
- A permanent failure alerts on the first failure and auto-deactivates the channel after five in a row, as before.
- A transient failure never deactivates the channel, and opens an alert only once the channel has been failing for five minutes. With the backoff that is the poll seven minutes in, and the owner email goes out at that point. The first successful poll resolves the alert. A server that fails intermittently, with successful polls in between, never builds up five minutes of continuous failure and does not alert; mail is still collected on the polls that succeed.
- The worker keeps its consecutive-failure count on `conv_inbound_state` instead of reading the alert's `occurrenceCount`, which now carries on across reopens. Migration `0109_conv_inbound_poll_backoff` adds `consecutive_failures`, `failing_since`, `last_failure_at` and `next_poll_at` to that table.
- `channel_inbound` alerts carry `metadata.failureKind`. The channel card shows "retrying automatically" for a transient failure instead of counting down to a deactivation that won't happen.
