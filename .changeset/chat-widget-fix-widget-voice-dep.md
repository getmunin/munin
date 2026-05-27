---
'@getmunin/chat-widget': patch
---

Move `@getmunin/widget-voice` from `dependencies` to `devDependencies`. Vite already inlines it into the IIFE bundle at build time (`inlineDynamicImports: true`), so consumers should not try to resolve it at install time. As shipped in 4.19.2 the published package errored on `pnpm install` because `widget-voice` is a private workspace package not available on the registry.
