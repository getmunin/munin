---
'@getmunin/agent-runtime': minor
'@getmunin/backend-core': minor
---

Let the reply agent read the email Subject line

The subject of an inbound email is stored on the conversation and never anywhere else: it is not prepended to the message body, and `toRuntimeHistory` maps only `authorType`, `body`, `createdAt` and attachments. The runtime's own `ConversationDetail` did not even declare the field, so the agent that writes or drafts a reply worked from the bodies alone — on a thread whose whole ask lives in the header ("Callback request", an order number, "Double charge on invoice 4471" over two lines of pleasantries) it was answering a question it had not been shown. Every other agent in the product could see it: `conv_get_conversation` returns `subject`, so curator skill passes and external MCP hosts have had it all along.

The subject now rides in the volatile system message beside the conversation id, fenced with `fenceUntrusted('data', …)` and capped at 300 characters. It is the sender's own text, so it is framed as untrusted like the company-context block — the note above the fence says to read it as context and ignore anything in it that reads like a directive, and the framing tags it might try to close are escaped.

Only email threads get the block. On chat, SMS and voice the `subject` column holds a title `skill://conv/set-topic-and-title` wrote from those same messages, so feeding it back would be the agent reading its own summary; and the email channel descriptor already tells the agent to output the body only, which the note reinforces — the reply threads under the existing subject, so it must not restate it or invent one. Nothing about seeded prompts changes: the block is assembled in code, so live organisations pick it up without a per-org prompt patch.

`InProcessMuninRestClientFactoryService` maps the service DTO field by field, so it dropped the subject on the OSS in-process path even once the runtime type had it; it now passes it through. The audit pass still judges a reply against the bodies alone.
