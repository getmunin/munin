---
'@getmunin/chat-widget': patch
---

Vite config now adds `development` to `resolve.conditions` when running in dev mode (`vite build --watch --mode development`). Without it, the chat-widget watcher resolved workspace deps like `@getmunin/widget-voice` through the `default` (production) export and required their `dist/` to exist before `pnpm dev` could start. With the condition wired up, dev resolves directly to each workspace package's `src/index.ts`. Production builds are unchanged.
