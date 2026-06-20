---
'@getmunin/backend-core': patch
---

Fix Threll in-browser (webrtc) voice calls dropping their transcript, recording/analysis, and mid-call tools. Widget voice/start now passes `{ conversationId, endUserId }` as web-call metadata, which Threll echoes back on every `call.*` webhook, so transcript/tool/ended events resolve to the conversation the visitor is viewing. The adapter also skips conversation creation for `webrtc` `call.worker_request` hooks (which fire before voice/start has linked the call and carry no correlation data — they'd otherwise mint a phantom conversation on the voice channel) and falls back to an org-wide `threllCallId` lookup so resolution still works for calls placed before the metadata round-trip is available.
