---
"@getmunin/dashboard-pages": minor
"@getmunin/backend-core": minor
"@getmunin/agent-runtime": minor
"@getmunin/agent-host": minor
"@getmunin/types": minor
"@getmunin/db": minor
"@getmunin/ui": patch
---

Redesign the onboarding "Lift-off" summary's website-import section into three real states — importing, failed, and succeeded — driven by live crawl progress.

The web crawler now emits incremental progress (`{ total, done, recentPaths }`) as it reads pages; the runner persists it to a new nullable `curator_jobs.progress` column (throttled, best-effort), and the curator-job DTO surfaces it via `GET /v1/curator/jobs/:id`. The summary screen polls that to show a live `done / total` counter, a progress bar, and the paths being read while importing; the imported page count and duration on success; and the failure reason plus an inline **Retry import** on failure. A new internal `POST /v1/curator/jobs/:id/progress` endpoint backs the out-of-process runner path.

Also align the full-screen loading screens with the page background: `AuthLoading` (and the root route loader) now paint `bg-bone` so the loader no longer flashes the lighter paper surface before the bone-backed page resolves.
