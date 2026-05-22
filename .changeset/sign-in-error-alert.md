---
'@getmunin/dashboard-pages': patch
---

Fix sign-in error alert. Two bugs:

- `auth.signIn.invalid.hintWithReset` used `{resetLink}` placeholder syntax, but the consumer (cloud login) calls `t.rich(...)` with a React-function value, which requires `<resetLink>...</resetLink>` tag syntax. The mismatch silently rendered nothing for the link, producing user-visible text like `"Check the address, or ."`. Switched the message to tag syntax (`<resetLink>reset your password</resetLink>`); the dead `resetLinkLabel` key is removed.
- Added `auth.signIn.unreachable.{title,hint}` so consumers can distinguish "wrong credentials" from "backend unreachable" instead of showing the same alert title for both. The OSS login page now picks the right title/body based on whether `authClient.signIn.email` returned a structured error or the request threw.
