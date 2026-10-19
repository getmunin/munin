---
'@getmunin/backend-core': patch
'@getmunin/agent-host': patch
'@getmunin/docs-pages': patch
---

Custom MCP servers no longer receive a customer's identity when the email that prompted the reply may be forged. If the latest customer message on an email conversation failed its DMARC check or was forwarded, the signed `X-Munin-Identity` assertion now leaves out `sub`, `email`, `phone`, `name` and their provenance, and carries an `identity_withheld` claim (`sender_auth_failed` or `sender_forwarded`) instead. A spoofed `From:` address could previously reach the org's own server as `channel_asserted` and let a personal tool act as that customer; servers that gate on `email` and its provenance, as the reference implementation does, now refuse with no change on their side. This matches the refusal Munin's own order, booking and contact self-service tools already apply. The custom MCP connector skill and the "Connect your own system" guide describe the withheld assertion.
