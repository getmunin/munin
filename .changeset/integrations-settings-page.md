---
'@getmunin/dashboard-pages': minor
---

Move the Slack card to a dedicated Integrations settings page

Slack was parked on the AI settings page for lack of a better home. It now lives on a new **Integrations** page (`/dashboard/settings/integrations`) under an "Operator bridges" section — the natural home for third-party surfaces, keeping AI settings to model/persona/skill config and leaving room for customer-facing data connectors alongside. The Slack card's i18n moved from `agentSetup.slack.*` to a new `integrations.*` namespace (en + nb).
