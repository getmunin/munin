---
'@getmunin/backend-core': patch
---

Deny `/mcp` to org roles that never earned the admin audience, instead of quietly
demoting them to the end-user surface.

`gateOauthGrantsByRole` strips `mcp:admin` for any role that isn't `owner` or
`admin`, and audiences are derived from that scope alone — so a `member`
completing the OAuth flow arrived with `audiences: []`. `deriveMcpAudience` was a
ternary whose else-branch dropped them onto `self_service`, the surface built for
widget and voice end users. Nothing announced the demotion.

That mattered because the two gates disagreed about the same person. The control
plane confines a member to a closed list — the conversations inbox plus the
per-user session routes, pinned by `member-surface.test.ts` so widening it has to
be a deliberate diff. MCP handed the same member `kb_search` and `kb_get_document`,
and the KB row filter narrows to self-service documents only when
`app.end_user_id` is set (`kb.sql`). A member sets `app.org_id` and no end-user id,
so the narrowing never applied: they could read every document in the org,
`audiences: ['admin']` ones included, and the `agent-runtime` space holding the
support agent's system prompt. Read-only, never across orgs, but well outside the
surface the role was drawn to have.

The surface was also broken for that caller by construction — roughly ten of the
~17 visible tools are `*_my_*` tools that bind to `actor.endUserId` and throw
`end-user identity required` on the first call. They were reached by accident of a
`? :`, not by design.

A `user` actor with no admin audience now gets a `member_forbidden` 403 — the same
code the control plane already returns — and `deriveMcpAudience` returns `null`
rather than an audience. Nothing legitimate loses access: delegated end-user tokens
carry an explicit `audiences: ['self_service']` and widget keys hardcode the same,
so a real end-user caller never has an empty array. Session cookies were never a
route here either — `AuthGuard` resolves them only for non-MCP paths, which is what
keeps `sessionCredential`'s unconditional `['admin']` stamp off this surface.

Two things deliberately left alone. `conv_request_human` on any org conversation
stays: members are granted the whole inbox on purpose, and flagging is strictly
less than the `POST :id/messages` they already have. And the
`app_end_user_id() = ''` idiom stays as-is across the RLS policies — the
conflation of "is an end user" with "is self-service audience" is wrong for `kb.sql`
but correct for `conv.sql`, where member-sees-all is the intent. Splitting them
wants a dedicated `app.audience` GUC, which belongs with a real member MCP surface
rather than with this fix.
