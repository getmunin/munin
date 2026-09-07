---
'@getmunin/dashboard-pages': patch
---

Align the console and settings shells: drawer, mobile bar, and sidebar width.

The two shells had drifted into three visible differences on the same account.

The mobile drawer opened as a full-width sheet on `bg-paper` in the console and a
320px panel on `bg-bone` in settings, and each rendered its navigation differently —
the console had a `mobile` variant of `NavList` with borderless 52px rows, settings
reused its desktop tree. The console drawer now takes the settings panel: same width,
same surface, same nav treatment, which removes the `mobile` variant entirely so both
shells render one list in both places. The console keeps its logo, brand and user
footer, since those are its identity and its only route to sign out.

The mobile top bar was bone in the console and white in settings. Neither header
declared a background: `DashboardShell` roots at `bg-bone`, and the settings branch
wraps children in `bg-paper`, so each header simply inherited whatever its ancestor
happened to be. Both now set the bone surface explicitly rather than depending on
that.

The desktop sidebar was a 280px grid column in the console and `w-72` — 288px — in
settings. Settings now matches at 280px.

One deliberate loss: the console drawer's explicit close button is gone, because the
settings drawer it now matches has never had one and `SheetContent` ships no built-in
close — both dismiss by backdrop or Escape. Adding a close affordance to both shells
would be the better end state and is not done here.

`nav.closeMenu` is now unused in this repo but kept, since `dashboard-pages` is shared
with the cloud web app.
