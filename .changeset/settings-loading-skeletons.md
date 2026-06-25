---
'@getmunin/dashboard-pages': patch
---

feat(settings): standardize settings page loading with content-shaped skeletons

Replaces the inconsistent per-page "Loading…" text with content-shaped skeletons across every settings page (API keys, channels, trackers, team, end-users, activity, audit log, usage, agents, AI, account). Table pages render proportional column-width row skeletons, list pages render card placeholders, the usage page shows tile and by-agent placeholders, and the activity feed shows row placeholders with a vertically-centered empty state. The AI settings page now renders each section header with its own per-section loading instead of a single global loader.
