---
'@getmunin/dashboard-pages': patch
---

Fix infinite /setup ↔ /oauth/consent redirect loop for managed-provider orgs.

The server-side onboarding gate (`redirectIfSetupIncomplete`) still keyed off `providerApiKeySet`, while the client setup/dashboard gates were migrated to `providerConfigured` (= own key OR a usable host-supplied default provider) in #513. For orgs running on a managed default provider — which never set their own key — the two gates permanently disagreed: the setup page considered onboarding complete and forwarded to OAuth consent, while the consent page considered it incomplete and bounced back to setup. `redirectIfSetupIncomplete` now reads `providerConfigured`, matching the client gates.
