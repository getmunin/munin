---
'@getmunin/backend-core': patch
---

Refuse ambiguous legacy identity hashes on `/v1/a/identify` and log a deprecation warning for the rest.

The pre-`mn.identity.v1` payload is the bare concatenation `${externalId}:${visitorId}`, which admits more than one field split whenever either field contains a colon: a signature minted for `("tenant:7", "vid")` also verifies for `("tenant", "7:vid")`, so a visitor holding one legitimately signed hash could re-bind it with the field boundary shifted and attach their browser to a different external id. Legacy hashes whose fields contain a colon are now rejected with `identity_hash_ambiguous`; colon-free legacy hashes (which have exactly one valid split) keep verifying but log `identify.legacy_hash` naming the tracker, so operators can see who still signs the old payload before the fallback is removed. Signatures over the length-prefixed `mn.identity.v1` payload are unaffected.
