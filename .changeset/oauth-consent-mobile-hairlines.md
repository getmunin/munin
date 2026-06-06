---
'@getmunin/dashboard-pages': patch
---

OAuth consent + auth-shell mobile polish:

- OAuth consent page now uses the dashboard's 0.5px hairline convention (`border-[0.5px]` + `dark:border-rule-on-dark`) on the section card, identity row, avatar tile, trust timeline, permission rows, scope pills, reassurance block, buttons, and result-pane status circle.
- Long client IDs no longer overflow: the H1, lede paragraphs, identity-card display name, trust-timeline body, reassurance block, and result-pane panel get `[overflow-wrap:anywhere]` (and `min-w-0 [word-break:break-word]` on the 72px H1 so single unbreakable client IDs wrap inside the 720px column).
- Auth-shell submit buttons (`AuthSubmit` + the inline `Link` CTAs on verify-email and reset-password success states) render their hairline via `shadow-[inset_0_0_0_0.5px_…]` instead of `border-[0.5px]`, matching the shared `@getmunin/ui` Button pattern — fixes iOS Safari dropping border edges on the ghost "Resend link" button.
