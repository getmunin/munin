---
'@getmunin/docs-pages': minor
'@getmunin/dashboard-pages': minor
'@getmunin/agent-runtime': minor
---

Rename agent recipes to role/task-shaped names that match how teams already describe the work: Lead Enricher → **Lead Research**, Lead Scorer → **Lead Scoring**, Bug Spotter → **Bug Triage**, Renewal Watcher → **Renewal Watch**, Win-Back Agent → **Win-Back**, Outreach Drafter → **SDR**. Recipe slugs in `packages/docs-pages/src/guides/` follow (e.g. `recipe-bug-spotter` → `recipe-bug-triage`, `recipe-outreach-drafter` → `recipe-sdr`); `dashboard-pages` `RECIPES` data updated to match. Cloud-side dependants need a coordinated bump of `@getmunin/docs-pages` to pick up the new exports.

Add two client guides: **Connect Hermes Agent** (Nous Research) and **Connect OpenClaw**, each with config snippets verified against the upstream MCP reference docs and the standard mint-key / verify / scope flow. Sort the Recipes and Clients categories alphabetically in `guidesByCategory()` so the sidebar and overview grid stay predictable as the library grows.

Tighten cloud landing-page copy and tool chips to match the actual recipes: drop the non-existent `task://web/scrape-website` chip from Lead Research; fix Bug Triage's italic ("hiding in conversations", not "tickets") and body (filed as internal notes via `conv_send_message`, not "structured proposals"); soften Renewal Watch's body ("account signals" rather than a fabricated "usage + sentiment + open issues"); fill in tool chips that were omitted (Lead Scoring, Renewal Watch, Event Follow-up, SDR, Conversation Distiller).

When the AI provider is unreachable on a brand-new conversation, the runtime now posts a generic hardcoded greeting (`"Hi, what can we do for you?"`) instead of escalating to a human — there is nothing for an operator to reply to before the visitor has said anything. The handover fallback path is unchanged for visitor replies: those still escalate with `"I'm having trouble responding right now. A teammate will follow up shortly."` (the trailing `"Thanks for your message —"` opener was dropped — the lead-in doesn't fit a turn where the visitor hasn't messaged us yet).
