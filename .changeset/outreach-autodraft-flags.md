---
"@getmunin/backend-core": minor
"@getmunin/db": minor
---

outreach: stop re-drafting already-contacted prospects + add per-campaign automation switches

- `outreach_propose_initial` now refuses a fresh first-touch when the contact already has a `sent` or `approved` initial proposal in that campaign (previously dedup only covered pending drafts, so the weekly curator could re-draft someone who was already emailed). `dismissed`/`failed` proposals still allow a re-draft.
- New `outreach_campaigns` columns `auto_draft_initial` (default `false`) and `auto_draft_replies` (default `true`), exposed on `outreach_create_campaign` / `outreach_update_campaign` / `outreach_list_campaigns`. The weekly first-touch curator only drafts for campaigns with `autoDraftInitial = true`, and inbound prospect replies are auto-drafted only when `autoDraftReplies = true`. Existing campaigns keep auto-replies but must opt in to automated first-touch.
