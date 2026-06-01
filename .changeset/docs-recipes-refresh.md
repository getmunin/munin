---
'@getmunin/docs-pages': minor
---

docs: refresh agent-recipe library

Replace recipes that the built-in curator already runs automatically (KB Curator → `skill://kb/review-content` weekly; CRM Deduper → `skill://crm/clean-contact-data` weekly) with four BYO-agent recipes that don't overlap with the auto-scheduler: Lead Enricher (event-driven), Lead Scorer (weekly), Win-Back Agent (weekly), and Event Follow-up (on-demand). Rename Content Marketer → Conversation Distiller and broaden its scope beyond FAQs to cover any recurring theme in conversations (questions, complaints, feature asks).

Surfaces affected: `guides/_lib/guides.ts` registry, new `guides/recipe-{lead-enricher,lead-scorer,conversation-distiller,win-back,event-followup}/page.tsx`, and exports in `index.ts`. Orphan source pages for kb-curator / crm-deduper / content-marketer are removed.
