---
'@getmunin/backend-core': minor
'@getmunin/dashboard-pages': minor
'@getmunin/core': patch
---

Schema-driven CMS draft drawer + safeFetch streaming fix.

**`@getmunin/core` — `safeFetch` body-stream lifecycle fix.** The undici agent was closed in a `finally` block as soon as `safeFetch` returned, so any response body larger than the initial socket receive buffer got cut off mid-stream and the body reader hung until the caller's `AbortSignal.timeout` fired. `safeFetch` now hands the agent's lifetime over to the response body via a `ReadableStream` wrapper that closes the agent on stream end, error, or cancel; small bodies and redirect/error paths still close immediately. New regression test exercises a 2 MB payload flushed in two halves with a 50 ms gap so this class of bug can't sneak back in. As part of the cleanup the same module dropped two silent `catch (() => {})` swallows in favour of `console.warn`, and the redirect/agent-cleanup logic was DRYed up.

**`@getmunin/backend-core` — CMS draft + asset endpoints.**

- `GET` and `PATCH /v1/cms-drafts/:id` now return `CmsDraftDetailDto extends EntryDto { fields: FieldDef[] }` so the dashboard always has the collection schema in hand.
- New `POST /v1/cms-drafts/:id/assets` uploads an asset (`{ name, mime, base64Body, altText? }` JSON) and returns the `AssetDto`. It does not touch the entry — the dashboard stages the new asset locally and commits it on Save.
- `CmsService.updateEntry` now runs `expandAssetsInDtos` before returning, so the PATCH response carries fully-expanded asset objects (previously the bare id string).
- `CmsService.listDraftEntries` derives a fallback `title` (and exposes `titleFieldName`) via `title → name → headline → subject → first required text field → slug`, so collections without a hardcoded `title` field still surface a sensible header.
- `validateEntryData` treats `""` / `[]` as "not present" for required-field purposes — previously a required text field with empty string passed validation.
- `CmsInvalidError` carries structured `fieldErrors`, and the controller surfaces them as `{ message, fieldErrors: [{ field, message }] }` on 400 responses so the dashboard can highlight the offending field instead of dropping a toast.
- `cms_create_collection` / `cms_update_collection` MCP descriptions now spell out that `fields` is an **ordered** array — order = render order in editor and public surfaces — and that `cms_update_collection` REPLACES the existing array.

**`@getmunin/dashboard-pages` — schema-driven CMS draft drawer.**

- Replaced the body-only editor with a per-field editor driven by `detail.fields`. Editors per type: `text` → input, `markdown` / `rich_text` → textarea (markdown is multi-row), `integer` / `number` → number input, `boolean` → checkbox, `select` → dropdown of `options.choices`, `date` / `datetime` → matching inputs, `asset` → drop-zone with click-to-pick, drag-and-drop, in-place replace, and uploading state.
- Read-mode renders each field in a consistent `ValueBox` (matches body's existing border treatment); markdown via `ReactMarkdown`; assets as a 16:9 figure. Empty optional fields are hidden in read mode; the field whose name matches `titleFieldName` is also hidden (drawer header already shows it).
- Save sends only the diffed fields as a single `PATCH /v1/cms-drafts/:id` with `{ data: ... }`. Asset fields serialize back to their id string.
- Backend `fieldErrors` surface inline: red label + destructive border + `aria-invalid` + a `role="alert"` message under each editor (no more "validation failed: x" toast).
- Asset drop-zone now reveals its "Replace cover image" label on hover with a paper-tinted overlay, instead of always overlaying text on the image.
- Drawer header close button gets `shrink-0 whitespace-nowrap` so "close ×" stays inline next to long wrapping titles.
- Inbox drawer reads its queue item from the live queue (by id) instead of holding a snapshot, so post-save header refreshes are visible.
- New `ApiError.fieldErrors` carries structured field errors through the fetch helper. Unused i18n keys (`cmsBody`, `cmsBodyPlaceholder`, `cmsCoverImage`, `cmsCoverEmpty`) removed.
