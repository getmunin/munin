---
"@getmunin/core": patch
---

The default voice system prompt no longer tells the agent it is continuing a browser chat. Inbound phone calls through Threll or Vapi use the same prompt, so callers who had never opened the chat widget were greeted by an agent that assumed they had. The "same assistant you were chatting with" framing now lives in the continuation opener, which is only used when a widget visitor switches to voice after the agent has already replied in chat.

Existing organisations keep the copy seeded into their `agent-runtime/voice-system-prompt` document; edit or delete that document to pick up the new default.
