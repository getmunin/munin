---
"@getmunin/types": patch
"@getmunin/agent-host": patch
"@getmunin/backend-core": patch
"@getmunin/dashboard-pages": patch
---

fix(agent): reconcile the model against the provider in one save

Switching provider in the dashboard was a client-orchestrated two-step: PUT
`/v1/agent-config` with the new base URL and key, GET `/v1/agent-config/models`,
then a second PUT to fix the model. The first PUT already emits
`agent.config.updated`, and the runner respawns on it, so for the length of the
models round trip (18 s in the incident that surfaced this) a live runner held
the new provider with the previous provider's model id. Anthropic 404'd a model
name it had never heard of, and every curator job draining in that window
hard-failed.

The reconcile now happens server-side inside the single upsert, before the row is
written and before the webhook fires: when the base URL or key changes, the
provider's model list is fetched and a `fastModel` it doesn't offer is replaced
with that provider's default (or the first model it does offer), while an unknown
`smartModel` is cleared. The runner can no longer observe a mismatched pair. The
same check guards the other direction — an explicitly supplied model the provider
doesn't offer is now rejected with an `agent_config_invalid_model` code instead of
being persisted into a config that can only 404, translated in both locales for
the one path a dashboard user can hit it on (a model dropped from the provider's
catalog while the page held a cached list). Providers without an OpenAI-compatible
`/models` endpoint are left alone, so bring-your-own gateways still work.

Provider failures also stop spending a job's retry budget. `attempts` is
incremented at claim and was never given back when a provider error parked the
job as `failed_retryable`, so a job that came back through the recovery sweep had
already burned attempts and the next genuine failure sent it straight to `dead`.
Parking now refunds the attempt. Provider alerts additionally carry the model id
and base URL, so a mismatch reads as one instead of a bare 404.
