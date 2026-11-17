---
'@getmunin/dashboard-pages': minor
---

The "this belongs to another workspace" notice now offers **Sign in with another account** beside the way back into your own org. Following a link into a workspace you are a member of with a different account no longer means signing out from the account menu and finding the link again: the button signs out and sends you to the login page with the link as the redirect, so you land on it once you sign in with the right account. The label and its "Signing out…" state match the OAuth consent screen's wrong-account pane.

"Sign in with another account" is the primary (solid) action there, with the way back into your own org as the outline alternative, mirroring the consent screen's wrong-account pane. The OAuth consent screen's action buttons now use the shared `Button` from `@getmunin/ui` instead of hand-styled elements, so both screens share one button style: mono, uppercase, with the shared hover and disabled states.
