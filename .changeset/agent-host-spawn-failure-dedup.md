---
'@getmunin/agent-host': patch
---

fix(agent-host): dedupe runner-spawn-failure logs

The runner reconcile loop attempts to spawn a runner for every provisioned `agent_config` row every 30 seconds. When the admin API key in `agent_config.admin_api_key_ct` doesn't resolve to a live `api_keys` row (e.g. after a partial DB reset), every spawn attempt logs an `ERROR` — N error lines per minute, indefinitely.

Now the same `(config_id, error_message)` is only logged at ERROR level once per 10 minutes. Subsequent identical failures during the cooldown emit at DEBUG level. A successful spawn (or a different error) resets the dedup state so the next failure is reported promptly.

The underlying credential mismatch is still surfaced — just not as a stuck error stream that drowns out everything else.
