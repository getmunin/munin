---
'@getmunin/dashboard-pages': patch
---

On mobile, claiming a conversation opens the composer instead of stopping a step short.

"Claim to review draft" took the claim and left the operator on the collapsed footer, which then offered "Review draft" — a second tap to reach the thing they had just said they wanted to do. Claiming from the mobile footer now opens the full-screen composer as soon as the claim lands.

Only that call site expands. `takeOverButton` takes an explicit `expandOnSuccess`, and the pane's two other instances sit *inside* the composer, which on mobile is already expanded; `expanded` also drives `role="dialog"` and `aria-modal`, which would be wrong on desktop where the composer is never a dialog. The draft is already in the textarea by then — it is seeded by an effect that does not depend on the claim — and `runAction` refetches the detail before resolving, so the expanded composer renders editable rather than as a read-only preview.

Not covered by an automated test: `dashboard-pages` has no component-rendering harness, and the `apps/web` e2e suite does not sign in.
