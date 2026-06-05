# @getmunin/chat-widget

## 4.40.0

## 4.39.0

## 4.38.0

## 4.37.0

## 4.36.0

## 4.35.0

## 4.34.0

## 4.33.0

## 4.32.0

### Patch Changes

- f6cb178: Vite config now adds `development` to `resolve.conditions` when running in dev mode (`vite build --watch --mode development`). Without it, the chat-widget watcher resolved workspace deps like `@getmunin/widget-voice` through the `default` (production) export and required their `dist/` to exist before `pnpm dev` could start. With the condition wired up, dev resolves directly to each workspace package's `src/index.ts`. Production builds are unchanged.

## 4.31.0

## 4.30.0

## 4.29.2

## 4.29.1

## 4.29.0

## 4.28.0

## 4.27.1

## 4.27.0

### Minor Changes

- 6c585ba: Localize the AI-down greet and handover fallback messages to the visitor's widget locale across all 13 widget-supported locales (en, nb, da, sv, fi, is, de, fr, es, it, pt, nl, pl). Previously a Norwegian visitor whose widget was in `nb` still saw English fallback copy when the LLM provider was unreachable.

  The chat widget now sends its picked locale on every conv-create / message-ingest request. The backend stashes it in `end_users.metadata.locale` (no schema migration — the column was already jsonb). `ConversationDetail.endUserLocale` exposes the value to the agent runtime, which looks up the localized string from a new `fallback-messages` module. Unknown locales and other channels (email, SMS, voice) fall back to English at lookup time.

  Greet copy mirrors the widget's existing `defaultGreeting` tone per locale (e.g. `nb: "Hei. Hva kan vi hjelpe deg med?"`); handover copy is a fresh translation matching each locale's existing widget tone.

## 4.26.0

## 4.25.0

## 4.24.3

## 4.24.2

## 4.24.1

## 4.24.0

## 4.23.5

## 4.23.4

## 4.23.3

## 4.23.2

## 4.23.1

## 4.23.0

## 4.22.0

## 4.21.0

## 4.20.0

## 4.19.4

## 4.19.3

### Patch Changes

- 0814264: Move `@getmunin/widget-voice` from `dependencies` to `devDependencies`. Vite already inlines it into the IIFE bundle at build time (`inlineDynamicImports: true`), so consumers should not try to resolve it at install time. As shipped in 4.19.2 the published package errored on `pnpm install` because `widget-voice` is a private workspace package not available on the registry.

## 4.19.2

### Patch Changes

- 0ea9b12: Publish `@getmunin/chat-widget` to GitHub Packages so the cloud backend image can install the prebuilt widget bundle from the registry instead of needing a workspace link. Aligns its version with the rest of the public OSS packages and adds it to the changesets `fixed` group so future releases keep all OSS package versions in lockstep.
