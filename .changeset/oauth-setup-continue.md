---
'@getmunin/dashboard-pages': patch
---

Onboarding wizard: drop the "Customize chatbot" / "Tweak settings" buttons from the lift-off card; keep only "Go to dashboard" + "Back". When the user arrived through an OAuth authorize flow (e.g. signing up via an MCP client), preserve OAuth params through the signup → setup chain and replace "Go to dashboard" with a "Continue" button that lands on the OAuth consent page.
