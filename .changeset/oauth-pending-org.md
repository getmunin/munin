---
'@getmunin/backend-core': minor
---

Expose which organization a pending authorization will bind to, so a consent screen can tell an org-scoped connection from a plain one.

`GET /v1/oauth/pending-org?code_challenge=…` answers `{ pinned, orgId? }` for the caller's own session. A dashboard cannot work this out from the URL: `resource` never reaches the consent page, because the provider signs the *validated* authorize query and `resource` is not part of that schema. Without this signal a consent screen has to pick one behaviour for both cases — either offer an organization switcher that cannot change what an org-scoped connection binds to, or hide it and remove the only way to choose the organization for a connection to the shared endpoint, since that one binds to whichever membership is `isDefault`.

The lookup is keyed the same way the association is written — an HMAC of the session cookie and `code_challenge` — so it only ever answers for the session that started the authorization, and a caller cannot probe another user's pending organization. Absent association, absent cookie, absent challenge and unregistered store all answer `{ pinned: false }`, which is the safe default: the caller then treats the organization as still up for grabs.
