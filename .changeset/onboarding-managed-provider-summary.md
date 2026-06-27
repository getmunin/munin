---
'@getmunin/dashboard-pages': patch
---

fix(setup): show the managed provider name in the onboarding summary

The "Lift-off" summary on the setup wizard always rendered the host of `providerBaseUrl`, so when the workspace was configured to use the managed AI provider it still displayed a stale bring-your-own-key host. The summary now renders the managed provider's name when no API key is set, falling back to the base-URL host for self-configured providers.
