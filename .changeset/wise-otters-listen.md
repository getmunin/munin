---
'@getmunin/backend-core': minor
'@getmunin/chat-widget': minor
---

fix(realtime): name why a widget socket was refused, and keep chat alive when identity is wrong

A widget socket whose identity was rejected got a bare `401` with no body — indistinguishable from a bad widget key, and unreadable from a browser. The handshake now answers identity and origin refusals as `403` with the code in an `X-Munin-Error` header and a `{"code":"…"}` body (`identity_partial`, `identity_verification_failed`, `identity_required`, `origin_required`, `origin_not_allowed`); `401` now means only that the credential itself failed. The socket also accepts `verifiedExternalId` as an alias for its `externalId` param, so one field name works across the socket, the ingest body and the `x-munin-verified-external-id` header.

The bundled widget no longer reconnect-loops forever on a rejected identity: after three handshakes that never open it drops the identity params, reconnects anonymously and warns on the console, so replies keep streaming while the secret is fixed. It re-arms the identity if the anonymous socket also fails to open (that is a network fault, not a bad hash), on the next `window.mn.widget.identify`, and on page load. `skill://conv/setup-chat-widget` now documents the socket params, the refusal codes, and the per-channel nature of the identity secret — an org with dev and prod widget channels has two secrets, and signing with the wrong one is what makes a widget send fine yet never receive.
