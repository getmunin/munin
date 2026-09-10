---
'@getmunin/backend-core': patch
---

Carry message attachments through the in-process runner REST client, so the agent actually sees
customer images.

The HTTP `createMuninRestClient` learned to pass attachments through, but `AgentHostRunner` always
resolves its client from `InProcessMuninRestClientFactoryService`, and that client dropped the field
in two places: `getConversation` rebuilt each message as `{ id, authorType, body, createdAt,
internal }`, and its own `toRuntimeHistory` did the same. `ConversationMessage.attachments` was
therefore always `undefined` on the path the OSS backend runs, so `loadHistoryImages` saw nothing to
fetch — no image reached the model, and no placeholder note explained the gap. `newestTurnIsSilent`
reads the same dropped field, so an image-only customer turn was still treated as silence.

Both mappings now carry `attachments`, and the integration test asserts a hydrated attachment
survives `getConversation` and comes out of `toRuntimeHistory` as `{ mime, url, name }`.
