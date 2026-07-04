---
'@getmunin/dashboard-pages': patch
---

Polish Norwegian (nb) dashboard translations. Replace the stiff blanket "tilbakekalle" for *revoke* with context-appropriate verbs (agents → "Koble fra", tokens/invitations → "Trekk tilbake", API keys → "Slett", tracker keys → "Deaktiver"), rename Trackers to "Sporing"/"Sporingskoder", and fix the anglicised "tokens" plural. Splits the shared `common.revoke` string into per-page `dashboard.agents.revoke` / `dashboard.apiKeys.revoke` keys so each surface can use its own verb.
