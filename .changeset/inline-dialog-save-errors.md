---
'@getmunin/dashboard-pages': minor
---

Show channel and tracker save failures inline in the form instead of replacing the dialog with a full-screen "Save failed" stage. The message (plus `request_id` when the server sent one) now sits above the footer, with the form's own submit button acting as the retry. Removes the `SaveErrorStage` component and its exports.
