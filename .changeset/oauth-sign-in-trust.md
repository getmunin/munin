---
"@getmunin/backend-core": patch
"@getmunin/dashboard-pages": patch
---

fix(auth): stop trusting GitHub for email-based account linking, and show where an OAuth client sends you before you consent

Signing in with GitHub no longer attaches the GitHub account to an existing Munin user unless GitHub reports the email as verified. GitHub was on the account-linking trusted list, which skips the check on whether the provider verified the email, so anyone could add another person's address to a GitHub account without confirming it and then sign in to that person's Munin account. Google stays trusted, since it only returns addresses it has verified. GitHub users whose primary email is verified are linked exactly as before.

The OAuth consent screen now shows the host the authorization code will be sent to ("You'll be sent back to …") next to the client's name, before you approve, instead of only after. That host is read from the signed authorization request, so it is the address actually used.

Client registration is open to anyone, so a client can call itself anything. When a client's name claims a well-known product (Claude, ChatGPT, Cursor, Grok or Copilot, or the vendor behind it) but one of its registered redirect addresses is a remote host that product does not own, `GET /v1/oauth/clients/:clientId` returns `impersonates: "<product>"`. The consent screen then names the client by its redirect host, drops the client-supplied logo, and shows a warning telling you to deny the request unless you trust that host. The icon endpoint serves the generic icon for such clients. Redirects to the local machine (`localhost`, loopback addresses and custom app schemes) do not trigger the warning, so local tools that register under a product name keep their normal screen.
