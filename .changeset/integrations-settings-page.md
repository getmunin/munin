---
'@getmunin/dashboard-pages': minor
---

Move the Slack card to the Integrations settings page

Slack was parked on the AI settings page for lack of a better home. It now lives on the **Integrations** page (`/dashboard/settings/integrations`, introduced in the integration foundations release) under the "Operator bridges" section, keeping AI settings to model/persona/skill config. The card moved to `components/integrations/`, its disconnect flow uses the shared confirm dialog, and its i18n moved from `agentSetup.slack.*` to `integrations.slack.*` (en + nb).
