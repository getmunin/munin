---
'@getmunin/core': minor
---

feat(core): add shared env-parsing helpers (`parseEnvInt`, `parseEnvBool`, `parseEnvDisableFlag`, `parseEnvCron`) and migrate existing call sites in core, backend-core, agent-host, and apps/backend.

`Number(process.env.X ?? D)` patterns previously passed NaN through silently when an env var was set to garbage; `parseEnvInt` falls back to the default in that case. `parseEnvDisableFlag` and `parseEnvBool` accept both `'1'` and `'true'` (case-insensitive). `parseEnvCron` returns `null` when the value is `'off'` or `'0'`, so callers can opt out of a cron without an inline guard.
