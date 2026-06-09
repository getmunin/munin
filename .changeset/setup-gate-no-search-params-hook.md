---
'@getmunin/dashboard-pages': patch
---

Fix prerender failure on `/setup` (round 2).

`useSetupGate` called `useSearchParams()` at the top level to detect a resumed OAuth-authorize flow. Even though consumers render the gate via a one-line `'use client'` page, that hook still triggers Next.js's SSG bailout — the wrapped `<Suspense>` around the wizard's `ReadyCard` (from 4.43.1) doesn't help because the gate runs before the wizard mounts.

Since the params are only read inside a `useEffect` (for navigation side effects), there's no need to subscribe to a reactive hook. Read `window.location.search` lazily inside the effect instead, removing the SSG bailout from the gate entirely.
