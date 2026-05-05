---
'@getmunin/backend-core': minor
'@getmunin/agent-sidecar': patch
---

CRM contact-extract curator — auto-applied per-conversation contact creation from chat.

When a conversation is `changeStatus`'d to `closed`, `ConvService` now enqueues a `skill://crm/contact-extract` curator job (dedupe-keyed by conversation id). The skill runs once per closed conversation, reads the thread, extracts identifying info volunteered by the end-user (name, email, phone, title, company), dedupes via `crm_find_contact`, then either `crm_create_contact` (new visitor) or `crm_update_contact` (backfills empty fields only — never overwrites human-curated data) with the conversation's `endUserId` linking the contact back to its participant. Tagged `from-chat` so operators can filter contacts that arrived this way.

**Auto-apply, not propose.** The data source is the user's own typed message — qualitatively different from KB curation, where the curator drafts new factual claims (LLM hallucination risk → must propose). For contact extraction the agent transcribes what the user said; if it's wrong the operator dismisses via the existing CRM list. No new Review tab, no proposal table.

**Composes with existing `skill://crm/hygiene`.** The hygiene curator runs weekly across the whole population and proposes merges for any duplicates this per-conversation extraction misses (e.g. visitor gives email in conv #1 and phone in conv #2 with no overlap). Different windows, different scope, complementary.

**Scope filtering:** the skill skips silently when the conversation has no `endUserId`, when nothing identifying was said, or when the linked contact already has email + phone + name populated.

Sidecar `toolPrefixesFor()` updated to allow `['conv_', 'crm_']` for the new skill. The cloud's `AgentRunnerService.toolPrefixesFor()` needs the same one-line addition (separate cloud PR after this OSS release).
