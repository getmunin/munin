---
'@getmunin/agent-runtime': minor
---

Move the KB-backed prompt resolver into the agent-runtime package. The
sidecar app imports it from `@getmunin/agent-runtime` instead of a
local module so the cloud multi-tenant runner can reuse the same code.
The shipped on-disk Markdown defaults (`prompts/system.md`,
`prompts/channels/*.md`) ship with the package; consumers resolve them
via the new `defaultPromptsDir()` helper.

New exports: `createPromptResolver`, `defaultPromptsDir`,
`PROMPT_SPACE_SLUG`, `SYSTEM_PROMPT_SLUG`, `CHANNEL_PROMPT_PREFIX`,
type `PromptResolver`, type `CreatePromptResolverOptions`.
