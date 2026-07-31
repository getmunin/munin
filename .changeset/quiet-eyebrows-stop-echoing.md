---
'@getmunin/dashboard-pages': patch
---

Eyebrows no longer echo the heading they sit above. The OAuth consent outcome screens paired "Authorization granted" with the H1 "Access granted." — and in Norwegian both collapsed to the identical string "Tilgang gitt", since `tilgang` covers both *authorization* and *access*. They now name the flow state instead ("Authorization complete" / "Autorisering fullført", "Authorization cancelled" / "Autorisering avbrutt"), leaving the ✓ glyph and the heading to carry the outcome.

Two inspector panels repeated a noun the same way and now add information instead: the outreach proposals eyebrow reads "Awaiting approval" (was "Pending proposals", above "Outreach proposals"), and the merge panel reads "Possible duplicates" (was "Pending merge proposals", above "Contact merges").
