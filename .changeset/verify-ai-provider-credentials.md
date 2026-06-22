---
"@getmunin/agent-host": patch
---

Actually verify AI provider credentials on save. Previously the "Save & test" step only failed on an explicit 401/403, so a bogus custom endpoint or a 200/404/HTML response was accepted silently. Validation now requires a 2xx response and an OpenAI-compatible body shape (`data: []` for `/models`, `data: {}` for OpenRouter's `/auth/key`); non-2xx, unreachable, non-JSON, and wrong-shape responses are rejected with a descriptive error.
