# @getmunin/chat-widget

## 4.52.1

## 4.52.0

### Patch Changes

- ce59242: Stop mobile browsers from zooming in when the message box or email field is focused. iOS Safari auto-zooms when a focused field's font is below 16px, so text-entry fields are now 16px on touch devices.

## 4.51.4

### Patch Changes

- d14b028: Open the chat widget full-screen on small viewports (phones in portrait and landscape, plus small tablets — up to 600px wide), matching the behaviour of Intercom/Crisp. The panel now goes edge-to-edge using dynamic viewport units, respects device safe-area insets, and locks page scroll while open so the conversation is usable on small screens.

## 4.51.3

### Patch Changes

- 0cc9260: fix(widget): probe voice availability without minting a provider session

  Opening a widget conversation used to call `POST /v1/widget/voice/start` purely to decide whether to show the call button. For Threll-backed voice channels that has a side effect — it creates a web call upfront (and overwrites `threllCallId`), so every conversation open burned a Threll session that was never connected to, then a second one was minted when the visitor actually started the call.

  The availability check now has its own cheap endpoint, `GET /v1/widget/voice/available`, which runs the same validation and voice-channel routing as `voice/start` but stops at a vendor config presence check — it never creates a Threll web call or fetches a Vapi assistant. The widget's open-time probe calls it instead of `voice/start`; `voice/start` now fires only when the visitor actually starts a call.

## 4.51.2

## 4.51.1

## 4.51.0

## 4.50.1

## 4.50.0

## 4.49.0

## 4.48.0

## 4.47.0

## 4.46.0

### Patch Changes

- 32c883e: Log previously swallowed errors in widget realtime, dashboard, and voice session paths. Empty `catch {}` blocks now emit `console.warn` for socket lifecycle/fetch failures and `console.debug` for listener-loop exceptions so issues surface during debugging instead of disappearing.

## 4.45.1

## 4.45.0

## 4.44.1

## 4.44.0

## 4.43.2

## 4.43.1

## 4.43.0

### Minor Changes

- 3858d3e: Link analytics tracking to CRM contacts and chat conversations through a shared `end_users` identity.

  Until now the analytics tracker, the chat widget, and the CRM lived in three separate identity silos: `analytics_view_events` carried only an opaque `visitor_id`, while the widget and CRM both spoke `end_users.id`. A visitor's page-view history stayed orphaned even when they later identified themselves in chat or signed in.

  This change introduces an `analytics_visitor_identities` bridge table mapping `(org_id, visitor_id) → end_user_id`, and a denormalised `end_user_id` column on both event tables that the analytics service stamps at ingest time. Two write paths populate the bridge:
  - **Widget**: `findOrCreateEndUser` in `widget-ingest.service.ts` now upserts the bridge whenever a chat session carries a `visitorId`. The chat widget and the analytics tracker now share the same `localStorage` key (`mn.vid`), so a visitor who first opens the widget retroactively links their already-stored tracker visitor id.
  - **Tracker**: new `POST /v1/a/identify` endpoint plus a `window.mn.identify(externalId, userHash)` method on the tracker bundle. Identity is verified by HMAC against a per-tracker secret; mint one via `analytics_create_tracker` (returned once) or rotate with the new `analytics_rotate_tracker_identity_secret` tool. Tampered hashes are rejected silently.

  Query tools now accept an optional `endUserId` / `contactId` filter (`analytics_views_over_time`, `analytics_subject_engagement`, `analytics_top_subjects`), and a new `analytics_contact_journey` tool returns the chronological page-view + search timeline for a known visitor. Past anonymous rows stay orphaned — there is no retroactive backfill.

  The dashboard gains a **Settings → Analytics trackers** page that lists trackers, mints new ones (with the public key + identity secret revealed once), shows whether identity verification is configured, and lets admins rotate the identity secret or revoke the tracker without dropping to MCP tools.

  The tracker bundle gains a script-tag identity path (`data-external-id` + `data-user-hash`), matching the chat widget's embed shape. The runtime `window.mn.identify()` call remains as the SPA escape hatch.

  The chat widget gets a matching runtime identity path: `window.munin.identify(externalId, userHash)` posts to a new `POST /v1/widget/identify` endpoint. When an anonymous chat session identifies mid-flight, the backend migrates the conversation: the verified `end_users` row replaces the `anon:…` one, the contact's `metadata.externalId` is updated, and the analytics bridge is rewritten — so the same browser's prior page-views attach to the now-known visitor without losing the chat history.

## 4.42.0

## 4.41.1

## 4.41.0

## 4.40.4

## 4.40.3

## 4.40.2

## 4.40.1

### Patch Changes

- 706d8c9: CodeQL cleanup: drop the `Math.random` session-id fallback in the chat widget (modern browsers always have `crypto.randomUUID`/`getRandomValues`), tighten the HTML-stripping regexes used by the web crawler and widget email fallback so nested/whitespaced `</script>` tags don't slip through, and rejection-sample in `makeId` to remove the modulo bias on the cryptographic random source.

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
