---
"@getmunin/core": patch
"@getmunin/backend-core": patch
---

Refuse to boot in production without a real API-key pepper and encryption key.

`createApp` now checks `MUNIN_KEY_PEPPER` and `MUNIN_ENCRYPTION_KEY` when `NODE_ENV=production`, the way `MUNIN_AUTH_SECRET` was already checked. Startup fails when either is missing, shorter than 16 characters, or looks like a placeholder or dev value (the same patterns the auth secret check uses, including the `.env.example` defaults). An empty pepper used to fall back to `''` silently, which let anyone sign preview, attachment, unsubscribe, email-open and voice-call tokens; `hashSecret` now throws in production when no pepper is set.

The minimum is 16 characters rather than the auth secret's 32 because neither value can be rotated cheaply: a new pepper invalidates every API key, widget key and signed link, and a new encryption key makes stored channel, connector and LLM secrets unreadable. The error message says so, so an operator sets the existing value instead of generating a new one.

The Docker image is unaffected: its entrypoint already generates and persists both values when they are unset or left at their placeholders.

New exports from `@getmunin/core`: `assertProductionKeySecrets`, `assertProductionSecret`, `isPlaceholderSecret`, `readKeyPepper` and `MIN_PRODUCTION_KEY_LENGTH`.
