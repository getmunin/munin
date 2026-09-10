---
'@getmunin/dashboard-pages': patch
---

Fill the model picker on first paint for an org with no provider key of its own.

`useAgentConfig` skipped `GET /v1/agent-config/models` unless `providerApiKeySet` was true.
That guard was correct when it was written — the endpoint could only answer by asking the
org's own provider — but it outlived its reason: the endpoint now serves the deployment's
managed list to an org with no key. The client kept not asking, so `models` stayed `null`,
and `ModelsCard` — which treats a managed provider as credentialed — fell through every
branch to its loading state and stayed there.

A host whose managed preset still carried a hardcoded `models` array masked it, because the
page fed that array to the card instead. The moment a host deletes the array and relies on
the endpoint, as the endpoint now invites, the picker reads `Loading…` on the settings page
and on the equivalent step of the first-run wizard until the operator presses Save on the
provider card, which is the one action that already refetched.

The guard now waits only for the config to arrive. An org that is neither keyed nor covered
by a managed list gets `supported: false` and renders the "needs a key" branch it already
had, so the extra request costs one small GET and removes the client's stale assumption
about when the server has something to say.
