---
'@getmunin/backend-core': minor
'@getmunin/docs-pages': minor
---

Three new skill markdown surfaces aimed at coding agents wiring a fresh frontend (Lovable, Bolt, Replit, v0, Cursor, Claude Code) to a Munin tenant:

- **`skill://playbooks/frontend-integration`** — end-to-end playbook covering the chat widget embed, analytics tracker embed, and live CMS delivery in one pass. Codifies the failures every coding agent currently hits cold: wrong API host (`munin.app` vs `api.getmunin.com`), legacy `/embed/widget.js` path, missing `data-munin-host` / `data-widget-key` / `data-channel-id` attributes, `originAllowlist` mis-set for preview origins, and the `Access to fetch … blocked by CORS policy` on `/v1/cms/*` that only resolves via server-side proxying. Resolves the host via `NEXT_PUBLIC_API_URL` / `VITE_API_URL` / etc. with per-framework table; explicit about empty-allowlist semantics under `MUNIN_WIDGET_REQUIRE_ALLOWLIST` / `MUNIN_TRACKER_REQUIRE_ALLOWLIST` (open-by-default in OSS dev, fail-closed in prod when set).
- **`skill://webhooks/subscribe-to-events`** — first markdown skill for the webhooks module. Walks through event-type selection, signed receiver implementation (HMAC-SHA256 verification with constant-time compare, raw-body capture per framework), idempotency via `x-munin-delivery-id`, 15s ack budget, and `webhooks_list_deliveries` for audit. Common patterns include forwarding `conversation.message.sent` into a widget UI over your own SSE/WebSocket, rebuilding a static site on `cms.entry.published`, and Slack-on-`crm.deal.stage_changed`.
- **`skill://cms/design-collection`** — the missing prequel to `migrate-content` and `publish-entry`. Catalogues all 14 field types with editor/storage shapes, walks through localization decisions, field-order-as-render-order, the two-pass setup for circular references, and the lossy semantics of `cms_update_collection` (drop = data orphaned but preserved in jsonb; rename = catastrophic without manual migration). Includes archetype sketches for blog, author, product, FAQ, and landing-page section collections.

Docs renderer (`@getmunin/docs-pages`):

- Enable `remark-gfm` so skill markdown tables and other GitHub-flavored syntax render correctly. Previously pipe-tables in `track-website-traffic.md` and the new skills collapsed into single paragraphs.
- New `renderSkillContent` helper substitutes `{{API_URL}}` in skill markdown with `NEXT_PUBLIC_API_URL` (falls back to `http://localhost:3001` for OSS dev). Lets prose show the live host while preserving `${API_URL}` inside real JS template literals in code samples.
