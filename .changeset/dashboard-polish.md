---
'@getmunin/dashboard-pages': patch
---

Dashboard polish: four small bug fixes.

- **`LoadFailed` red dot was invisible.** The eyebrow dot's class string was a concatenation typo (`bg-alert-bad-border-[0.5px]` — `bg-alert-bad-border` ran into a stray `border-[0.5px]`), so the dot rendered without a background colour. Fixed to `bg-alert-bad-border animate-pulse` to match the live-state dot pattern used elsewhere.
- **`AuthForm` invalid border was invisible.** Same concatenation typo (`border-alert-bad-border-[0.5px]`) meant invalid inputs in the auth flow didn't actually get a red border. Now uses `border-alert-bad-border` (with the border-width already declared on the base class).
- **Inbox `LoadFailed` no longer hugs the top-left.** When the overview can't load, the error card now sits in a `flex min-h-[70vh] items-center justify-center` wrapper so it's centred both horizontally and vertically.
- **`SystemAlertsBanner` no longer flickers on transient reconnects.** A short WS blip used to flash the yellow "Connection lost. Reconnecting…" banner. The component now debounces the disconnected state by 1.5 s — if the socket reconnects within that window, the banner never shows; it still hides immediately on reconnect.
