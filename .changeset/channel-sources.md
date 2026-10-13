---
"@getmunin/db": minor
"@getmunin/types": minor
"@getmunin/backend-core": minor
"@getmunin/dashboard-pages": minor
---

Pin a channel to its own knowledge-base spaces and store connections, so an org that runs several sites can keep one site's answers out of another's conversations. `conv_set_channel_sources` (and `PUT /v1/conversations/channels/:id/sources`) takes `kbSpaceIds` and `connectionIds`; `conv_get_channel_sources` (and `GET` on the same path) reads them back. Each list replaces the current one, an omitted list is left as it is, and an empty list lifts that restriction.

With KB spaces set, the support agent and voice tool calls in that channel's conversations can only search and read self-service documents in those spaces. The filter lives in the `kb_documents` and `kb_document_chunks` row-level security policies, keyed by an `app.kb_space_ids` setting the tenancy layer derives from the actor's conversation, so it holds for every KB read rather than only for search.

With connections set (at most one commerce and one bookings connection per channel), commerce and bookings tools in that channel's conversations use the pinned connection without a `connectionId`, and refuse a call that names a different one. Search-console connections cannot be pinned. Deleting a pinned connection is refused with `connectors_connection_bound` until it is unpinned, so removing one store's connection can never silently send that channel's lookups to the store that remains.

The Channels page sets the same bindings: every add and edit channel dialog has a **Knowledge** tab next to the channel settings, where the knowledge base is either all spaces or a ticked list, with a store and a bookings picker. Its label shows the current scope, and a bound channel's card lists its spaces and pinned connections. The email channel dialog is regrouped into sending (from name and address, SMTP, delivery options), receiving and agent replies: the SMTP settings collapse to a one-line summary when editing, and agent replies are a three-way switch. `GET /v1/conversations/channels/sources` returns every channel's bindings in one call for that page.

Teammates, admin agents and delegated end-user tokens are not restricted, since none of them act inside a single channel's conversation. Vapi and Threll tool calls now carry the verified conversation id, which is what lets the bindings apply to voice.

Migration `0113_conv_channel_sources` adds the `conv_channel_kb_spaces` and `conv_channel_connections` tables.
