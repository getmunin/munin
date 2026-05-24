---
'@getmunin/backend-core': minor
---

Handle Vapi `assistant-request` webhook: dynamically inject system prompt + tools + caller context for inbound PSTN calls.

Before this change, inbound calls fell into the webhook's `default` branch and were ignored — Vapi used whatever assistant prompt was pre-configured in its dashboard, with no Munin context. The first Munin learned about the call was when the first transcript turn arrived (which triggers `findOrCreateConversation` lazily).

Now, when Vapi fires `assistant-request` (it's the first event for any call, fired before the assistant speaks), the adapter:

1. **Pre-creates the conversation** by reusing `findOrCreateConversation`, so subsequent transcript / tool-calls events have a known conversationId in `assistantOverrides.metadata`.
2. **Auto-creates the conv contact + end_user** from the caller's phone (same `findOrCreateContactByPhone` path used elsewhere).
3. **Looks up the CRM contact** by phone (best-effort).
4. **Fetches the channel's Vapi assistant config** via `VapiClientService.fetchAssistantConfig` to inherit voice / transcriber / voicemail / recording settings.
5. **Builds an inline assistant** with:
   - System prompt = KB `voice-system-prompt` + company profile + caller context (CRM name/email if found, otherwise "first-time caller" note).
   - The voice opener prompt as a second system message.
   - The MCP self-service tool surface (`VapiToolBridge.buildToolList()`).
6. **Returns `{ assistant, assistantOverrides: { metadata: { conversationId, endUserId } } }`** so Vapi uses our inline config for this call and stamps our metadata onto subsequent webhook events.

**Fail-soft:** if any step fails (Vapi API unreachable, KB read error, etc.), the handler returns `{}` and Vapi uses its default assistant. The conversation pre-create runs *before* the Vapi fetch so even on Vapi-fetch failure the conversation row still exists and subsequent transcripts resolve correctly.

**Refactor:** moved `composeVoiceSystemPrompt`, `buildInlineAssistantConfig`, `OrgScopedKbDocReader`, `INHERITED_ASSISTANT_FIELDS` from `widget-voice.service.ts` to a new `vapi-assistant.ts` so both the widget path and the inbound PSTN path share one source. `composeVoiceSystemPrompt` gains an optional `extraContext` parameter for the caller context block.

`runAsSystem` became generic `<T>` so the assistant-request handler can read DB state out of the transaction.

Tests: extended `vapi.integration.test.ts` with two cases — assistant-request creates the conversation + contact + end_user even when the Vapi fetch fails; assistant-request with no `callId` is a no-op.
