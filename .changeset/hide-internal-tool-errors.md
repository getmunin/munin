---
'@getmunin/core': minor
'@getmunin/db': minor
'@getmunin/mcp-toolkit': patch
'@getmunin/backend-core': patch
'@getmunin/agent-runtime': patch
'@getmunin/agent-host': patch
---

Stop returning raw internal errors from MCP tools, and take the at-rest encryption key out of SQL parameters.

A tool that failed on a database or runtime error used to hand the caller the error's own message. For a failed query that message is drizzle's `Failed query: … params: …`, so the SQL and every bound parameter reached the calling agent (end-user agents included), the audit log, stored job and delivery errors, and the server log. Until now the at-rest encryption key was itself a bound parameter: every request transaction ran `set_config('app.crypt_key', $1, true)`.

**The encryption key travels once per connection, never with a query**

- `createDb` sends `MUNIN_ENCRYPTION_KEY` as the `app.crypt_key` startup parameter when it opens each pooled connection. It reads the key when the pool is created, or takes it from the new `encryptionKey` option. `current_setting('app.crypt_key')` works for the whole session, including for the non-superuser `munin_app` role, and survives `RESET ALL` and `DISCARD ALL`.
- The per-transaction `set_config('app.crypt_key', …)` is gone from the tenancy interceptor, the agent-host service context and every decrypt/encrypt helper. No statement carries the key any more, so it cannot appear in a failed query's text, its parameters or `pg_stat_activity`.
- `setEncryptionKeySql` is removed from `@getmunin/core`. A pool created through `createDb` already has the key, so drop any call to it. Code that opens its own `postgres` client needs to pass `app.crypt_key` as a connection parameter.
- Set `MUNIN_ENCRYPTION_KEY` before the database pool is created. Changing it now takes a process restart, since existing connections keep the key they opened with.
- A pooler that multiplexes transactions across server connections (PgBouncer in transaction mode) does not forward custom startup parameters, and it already did not forward `app.bypass_rls`. Connect the backend to Postgres directly, or use session pooling.

**Internal errors stay on the server**

- MCP tools now return `internal_error: … quote ref <correlationId>` for database errors, socket errors, built-in runtime errors (`TypeError`, `RangeError`, …), thrown non-errors, and any message that embeds a failed query. The audit row records `internal_error[<ErrorClass>:<SQLSTATE>] ref <correlationId>`. The full error is logged on the server under the same ref and passed to the error reporter with a `ref` field.
- Deliberate errors keep their message unchanged, so agents still get the `<code>: …` prefix they act on. That covers Nest `HttpException`s, the modules' own error classes, and plain `Error`s thrown with a coded message. Rate-limit and quota failures follow the same rule.
- `/v1` audit rows use the same rule.
- Stored error text has `params: …` replaced with `params: [redacted]` before it is written. That covers `audit_log.error`, `curator_jobs.last_error`, outreach `failure_reason`, social post and account `last_error`, alert details, and alert-notification and widget-fallback errors. Channel test results returned to admins are redacted the same way.
- `createApp` installs a console logger that redacts `params: …` in logged messages and stacks and keeps the SQL text; pass your own `logger` to opt out. The direct `console.*` calls in core, backend-core, mcp-toolkit and the agent runtime now log through `describeError`, which redacts. A test fails the build if one logs a raw error object or `err.message` again.
- `@getmunin/core` exports `isInternalError`, `internalErrorKind`, `auditErrorText`, `errorMessage`, `errorClassName`, `sqlStateOf`, `redactQueryParams`, `redactQueryParamsDeep` and `redactLogValue`. It also has a dependency-free `@getmunin/core/errors` entry point for code that loads before the rest of the app, such as an error-reporter init.
