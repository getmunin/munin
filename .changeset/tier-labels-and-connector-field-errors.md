---
'@getmunin/backend-core': patch
'@getmunin/dashboard-pages': patch
'@getmunin/ui': patch
---

Localize the smart/fast model-tier badges (nb: "rask") and surface connector config validation as inline field errors: invalid connector config now returns structured `fieldErrors` instead of a raw zod JSON blob, and the connect dialog highlights the offending inputs with localized per-field messages instead of toasting. The Tailwind preset now defines the `aria-invalid` variant (absent from Tailwind v3 defaults), so the destructive border/ring on invalid inputs actually renders.
