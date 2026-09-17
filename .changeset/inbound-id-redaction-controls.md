---
'@getmunin/backend-core': minor
'@getmunin/dashboard-pages': minor
---

Add the controls for inbound national-ID redaction.

A new Privacy page under settings, `conv_get_redaction_policy` / `conv_configure_redaction` on MCP, and `GET/PUT /v1/conversations/redaction` behind it. An org picks which identifier types to act on, whether a match is masked down to its birth date or removed outright, and how certain a match must be before anything happens.

The policy gets its own route rather than riding `PATCH /v1/orgs/me`, which replaces the whole settings object and would let two unrelated settings edits clobber each other. The write merges a single namespaced key instead.

Also routes `stripMessageSignature` through the same filter. It is the second writer of `metadata.preStripBody`, so without this the signature curator could put an unredacted body back after ingest had cleaned it.
