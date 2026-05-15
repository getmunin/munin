---
"@getmunin/core": minor
"@getmunin/db": minor
"@getmunin/types": minor
"@getmunin/sdk": minor
"@getmunin/mcp-toolkit": minor
"@getmunin/bootstrap": minor
"@getmunin/ui": minor
"@getmunin/dashboard-pages": minor
"@getmunin/backend-core": minor
"@getmunin/agent-runtime": minor
"@getmunin/agent-host": minor
---

Make `@getmunin/dashboard-pages` the canonical home for OSS messages so downstream apps don't have to copy the shared keys.

**New exports:**

- `loadBaseMessages(locale)` — dynamic-imports the bundled `en.json` / `nb.json`. Returns a `MessagesTree`.
- `mergeMessages(base, overrides)` — recursive deep merge for spreading host-app overrides on top of the base messages.
- `BASE_LOCALES` / `BaseLocale` — the locale set the package ships translations for.

The OSS web app's `apps/web/messages/{en,nb}.json` are gone — their content moved to `packages/dashboard-pages/src/messages/`. `apps/web/i18n/request.ts` now calls `loadBaseMessages(locale)` directly.

Downstream apps (e.g. munin-cloud) can adopt the same loader and pass only their cloud-specific overrides:

```ts
const base = await loadBaseMessages(locale);
const overrides = (await import(`../messages/${locale}.json`)).default;
return { locale, messages: mergeMessages(base, overrides) };
```

This is additive — no existing exports removed.
