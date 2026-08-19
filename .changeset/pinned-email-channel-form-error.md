---
'@getmunin/dashboard-pages': patch
---

Pin the submit error in the email channel dialog to the footer instead of leaving it in the gap below the scroll area.

The email channel dialog is the only one that scrolls an inner region rather than the whole popup, so its `FormError` rendered as a detached inset box wedged between the scroll container and the footer — misaligned against both neighbours' negative-margin bleeds, and with no spacing from the fields above. `FormError` now takes a `pinned` variant that drops the box for a `rule-soft` separator inset to the content width, on the same 16px/16px rhythm as the rule under the dialog header, so the error reads as a continuation of the form rather than a third structural zone competing with the footer plinth. It stays visible regardless of scroll position. Also raises the destructive fill of the boxed variant in dark mode, where 5% of `#d96a6a` over the card background was effectively invisible.
