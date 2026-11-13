---
'@getmunin/ui': patch
---

Dialogs now scroll a validation error into view when it appears outside the visible part of a scrolling dialog, and again each time the form is resubmitted while the error is still showing. Before, saving a long form such as the email channel dialog could fail on a field below the fold with nothing visibly happening. Errors are found by `role="alert"` or `aria-invalid="true"`, so every dialog built on `DialogContent` picks this up without changes; an error that is already visible is left alone.
