---
"@getmunin/core": patch
---

feat(prompts): add handover policy to the seeded self-service system prompt

The default system prompt that new workspaces are seeded with now tells the self-service agent, when it flags a conversation for a human, to let the end-user know a teammate will follow up in the same conversation — and not to redirect them to email/phone/in-person or volunteer the business's contact details unless explicitly asked. This keeps the lead in the thread the human is about to pick up instead of routing it off-channel.
