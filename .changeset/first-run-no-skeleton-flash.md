---
'@getmunin/dashboard-pages': minor
---

A first-run workspace now renders its onboarding steps in the server HTML, with no spinner and no skeleton in front of it, and every console page decides that the same way.

The dashboard shell used to withhold every page behind a `PageSpinner` until four client fetches — session, membership, agent config, setup state — had all landed, and Dashboard and Automation then held a skeleton until a second fetch (usage summary, automation summary) landed on top of that. `readDashboardBootstrap()` now does that work on the server: a new `@getmunin/dashboard-pages/server` export reads the session cookie, fetches memberships, agent config and setup state in parallel, and feeds them to a `DashboardBootstrapProvider` that seeds `useActiveMembership`, `useAgentConfigStatus` and `useSetupState`. With those seeded the gate is satisfied on the first render, so the shell, the sidebar and the first-run scene are all in the initial HTML.

The bootstrap is deliberately conservative and returns `null` — falling back to the existing client path unchanged — when there is no session cookie, when any fetch fails or exceeds 1.5s, when setup is incomplete (that user belongs on `/setup`, and the redirect stays client-side), or when the user belongs to more than one org. The active-org pin lives in `sessionStorage`, which a server render cannot see, so for a multi-org user the server cannot tell which org to fetch; single-tenant OSS deployments always take the fast path.

On that fallback path `SetupStateProvider` now mounts alongside the spinner rather than behind it, so the setup fetch runs beside the gate's own fetches instead of queueing after them. It takes an `enabled` flag, and `useRealtime` an `enabled` option, so a signed-out visitor still opens no socket and fetches nothing.

Dashboard, Conversations, Review and Automation now share one `useFirstRunGate()` returning a single `view` of `loading | firstRun | content`, replacing four different hand-rolled conditions. A page narrows first run with its own emptiness rule — `topicCount === 0` on Automation, nothing pending on Review — and returns `null` from that rule when it cannot decide yet, which reads as `loading` rather than a wrong guess. Dashboard passes `content: inbox.hasLoadedOnce` so its own data gates only the content branch, never the first-run branch, and it names its skeleton once instead of twice. Automation additionally reads its topic count from the setup snapshot rather than from the automation summary, so deciding first run needs one request instead of two.

`useDashboardGate` also drops its duplicate `roleLoading` term — `useActiveRole` returns `useActiveMembership`'s own loading flag — in favour of three named booleans, and the three copies of "fetch JSON from the API forwarding the caller's cookie" in `setup-gate.ts`, `server-session.ts` and the new bootstrap now share one `fetchJsonWithCookie` helper.
