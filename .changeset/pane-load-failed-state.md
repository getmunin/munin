---
'@getmunin/dashboard-pages': patch
---

Give the conversation pane the shared load-failure state instead of a bespoke one.

When a conversation's detail fetch failed, the pane rendered its own small block: a mono
eyebrow, the translated message, and an outline retry button. The eyebrow used
`text-ink-mute` — byte-identical to the "select a conversation" empty state a few lines
above it — so a failure looked like an empty pane rather than something that went wrong.
It also dropped the diagnostics: `detailErrors` stored `translateErr(err)`, a string, so
the `ApiError` and with it the request id were discarded at the point of capture. A page
level failure hands the user a request id to quote; this one left them with nothing.

`LoadFailed` gains a third size, `pane`, beside `inbox` and `settings`. It keeps the
alert eyebrow with its dot and the `request_id` / `endpoint` / `status` table, and drops
the display type to `text-2xl` so it fits beside a working list — the `inbox` size is a
56px headline, which inside a split pane would claim the whole app is unreachable when
one fetch is. At `pane` size the heading renders as `h2`, since the list column beside it
already owns the page's `h1`. No auto-retry hint: unlike the queue load, a failed detail
fetch has no interval behind it, and the page-level copy would have promised one.

`detailErrors` on the conversation queue controller now holds the `ApiError` itself, and
`usePaneLoadFailedProps` translates it for the lede at render time — same message as
before, with the diagnostics still attached. The overview drawer's own `detailErrors` in
`inbox-data.ts` is a separate controller and keeps its string shape; it is a different
surface and is not converted here.
