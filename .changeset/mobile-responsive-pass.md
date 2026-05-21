---
'@getmunin/dashboard-pages': minor
'@getmunin/ui': minor
---

Mobile responsive pass across the dashboard:

- **Overflow**: responsive `px-4 md:px-10` on the overview container, and `min-w-0` on the Get-Started grid cells so the long `Authorization: Bearer mn_live_…` snippet no longer widens the body and bleeds the recipes column past the viewport.
- **Tables**: api-keys, team, agents, audit-log, and end-users tables now hide low-priority columns on mobile (`hidden md:table-cell`) and wrap in an `-mx-6 overflow-x-auto px-6` scroll container so anything still overflowing scrolls within the content area instead of widening the body.
- **Hover-on-touch**: enable Tailwind's `future.hoverOnlyWhenSupported` so `hover:` and `group-hover:` only fire on devices with `@media (hover: hover)`, eliminating sticky-hover on tap.
- **Truncation**: `RecentConversations` rows now truncate as a single line (move `truncate` from the inline preview span to the parent block).
- **Topbar (mobile)**: org/brand name now appears centered in the topbar on mobile (was desktop-only). Settings menu button is now a `<Button variant="outline" size="icon">` instead of an inline `<button>`.
- **Dashboard hero**: eyebrow shows the date only; org name moved to the topbar.
- **Section dividers**: get-started's top hairline removed; recent-conversations and queue rows keep their soft-gray bottom border on the last item so the section self-closes.

### `@getmunin/ui`

- **Button primitive**: all variants except `link` now render their hairline frame via `shadow-[inset_0_0_0_0.5px_…]` instead of `border-[0.5px]`. Shadows are rasterized through a different paint path and don't collide with adjacent hairlines (table-row bottom borders, header bottom borders), which on iOS Safari Retina was dropping the button's bottom edge.
- **Pill primitive**: same shadow-inset hairline using `currentColor`, so the frame inherits whatever text color the variant sets without a separate `border-current` declaration.

The `border-[0.5px]` convention is unchanged everywhere else (Hairline primitive, card / dialog / input / table-row dividers, etc.); only the elements that sit flush against another hairline switched to the shadow rendering path.
