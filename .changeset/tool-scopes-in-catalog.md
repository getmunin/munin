---
'@getmunin/backend-core': patch
---

Guard that every `@McpTool` scope is one an OAuth client can actually be granted.

A tool may declare any string in its `scopes`, but only what `SUPPORTED_SCOPES`
advertises can be requested by a client, consented to on the consent screen, or
carried in an access token. Declare `billing:read` on a tool without adding it to
the catalog and the tool disappears for every OAuth agent — `tools/list` filters
on `actor.hasScope` — while continuing to work under a wildcard API key or a
system actor. Nothing failed; the tool simply was not there, which reads as a
client problem rather than a missing constant.

The existing `oauth-resource.controller.test.ts` case looks like it covers this
and cannot: it asserts `scopes_supported ⊆ SUPPORTED_AUTH_SCOPES`, and
`scopes_supported` is derived from that constant, so the check is tautological.
The new test scans the decorator sites instead and fails with the file and the
stray scope named. A second case asserts the scan actually found tool scopes, so
a regex that silently stops matching cannot pass as a clean result.
