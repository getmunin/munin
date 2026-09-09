---
'@getmunin/agent-host': minor
'@getmunin/dashboard-pages': patch
---

feat(agent-host): let a managed provider offer several models instead of pinning one

A deployment can supply the LLM itself, so an org never has to bring its own key. That
managed provider resolved the model through `ResolvedProviderAuth.model`, and the runner
applied that one value to **both** tiers: `auth.model ?? config.fastModel` and
`auth.model ?? config.smartModel ?? …`. So an org on the managed provider could pick a
model in the dashboard, the write would persist, and generation would silently ignore it.
Offering a second managed model was impossible without changing this line.

**Breaking for hosts that pass `resolveProviderAuth`:** `model` is replaced by `models`,
the list of models that provider offers, first entry the default. A single-element list
is the old pinning behaviour exactly, so `model: 'x'` becomes `models: ['x']`. The two
fields together would have allowed a default outside its own allow-list — one more state
to define and test for nothing, since ordering already expresses which is the default.
Dropping `model` also makes the migration a compile error rather than a silently ignored
property. Display order is unaffected: the dashboard sorts models by id.

`resolveModelTiers` reads the org's own `fastModel` / `smartModel` whenever they appear
in the list, falling back to the first entry for a choice the provider no longer offers.
Hosts that pass no `models` (every org on its own key) keep reading the org's config as
before.

Two consequences of the old shape are fixed with it:

- **An org on the managed provider could persist a model that does not exist.**
  `resolveModels` bailed on `!apiKey` before validating, because validation meant asking
  the org's provider for its `/models`. It now validates against the managed list when
  the org has no key of its own, throwing the same `agent_config_invalid_model` the
  bring-your-own-key path throws — the dashboard's existing
  `errors.agent_config_invalid_model` copy already reads correctly for it. With no
  managed list configured the early return stands, so deployments without one behave
  exactly as before.
- **`GET /v1/agent-config/models` answered `supported: false` for those orgs**, leaving a
  host no way to publish its managed models other than hardcoding them into its provider
  preset. It now serves them, and switching a provider card to the managed preset reads
  the endpoint when the preset carries no list of its own, so the model picker fills in
  without a reload. A preset that does list models still wins. `listForCurrentActor` also
  stops reading the config row before it knows whether there is a key to use it with.

The list reaches both through `AgentHostModule.forRoot{,Async}({ defaultProviderModels })`,
normalized (trimmed, blanks dropped, deduped, configured order kept) into the new
`DEFAULT_PROVIDER_MODELS` token.

Note for whoever wires a second model up: token quotas are counted per token with no
regard for which model produced them, so a frontier-priced model shares the cap of a
cheap one until the host weights it.
