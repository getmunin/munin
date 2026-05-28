---
'@getmunin/backend-core': minor
'@getmunin/dashboard-pages': minor
---

Add GitHub OAuth sign-in alongside Google and expose a public `/v1/auth/providers` endpoint so the login UI can show only the providers the deployment has actually configured.

- `backend-core`: new `readGithubProviderFromEnv()` reading `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`, and a new anonymous `AuthProvidersController` at `GET /v1/auth/providers` returning `{ google, github }` booleans.
- `dashboard-pages`: split `use-auth-providers.tsx` into a `'use client'` hook module and a server-safe `fetch-auth-providers.ts` so server components (e.g. the OSS login page in Next 16) can call `fetchAuthProviders()` without tripping the RSC client-boundary check. Adds `GoogleLogo` / `GithubLogo` exports, `or` + `googleButton` / `githubButton` i18n strings (en + nb), and uppercases the first OSS auth footer item.
