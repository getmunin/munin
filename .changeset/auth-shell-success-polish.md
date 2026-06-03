---
'@getmunin/dashboard-pages': patch
---

Auth-shell polish: nudged the logo to `left-8` on mobile (`md:left-14` from medium up) so it no longer clips into the left safe area on small screens, autoFocused the primary action on the forgot-password "sent", reset-password "done", and verify-email "done" success states so keyboard users land on the next step, restyled the reset/verify success CTAs to the ink/paper button treatment used elsewhere (dropping the legacy `auth-navy` token), and replaced the bordered info pill on the "email sent" state with a flat block that reads cleaner against the auth panel.
