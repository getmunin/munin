---
'@getmunin/ui': patch
'@getmunin/dashboard-pages': patch
---

1px hairlines everywhere, tuned rule weight, and honest bookings connector copy:

- All `0.5px` borders and inset-shadow outlines are now `1px` — sub-pixel widths rendered inconsistently across devices.
- Rule alpha compensates for the doubled width (light `0.145 → 0.09`, dark `0.2 → 0.13`) and is now single-sourced from the `--munin-rule-*-alpha` tokens; the tailwind preset, Button, and the team-page role select reference the tokens instead of hardcoding alphas.
- Buttons, pills, auth-shell CTAs, and the team role select draw their outline with a real `border` again instead of the inset box-shadow workaround (iOS Safari only dropped sub-pixel borders; integer widths are safe). Pill padding compensates so rendered size is unchanged; pill outlines soften to 55% `currentColor`.
- Dashboard/settings topbars adopt the marketing-site chrome: translucent blurred bar with a soft always-on hairline instead of a full-ink border. System-alerts banner border softens from full ink to `ink/20`.
- Dialog field hints are smaller and grayer (`text-xs text-ink-mute`) to read as metadata next to labels.
- Gastroplanner connect dialog now advertises the full bookings surface (check availability + book, change/cancel) instead of lookup only, and the "read directly — never copied" note is reworded to "live against the vendor — nothing stored in Munin" since bookings writes. Sonner toasts get their intended ink border (the CSS var name was previously mistyped and ignored).
