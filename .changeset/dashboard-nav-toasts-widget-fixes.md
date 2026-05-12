---
'@getmunin/dashboard-pages': minor
---

Dashboard navigation overhaul, action feedback via toasts, widget fixes, and onboarding polish.

**Navigation**
- New `DashboardTopbar` (cog → Settings, rotate-on-hover) replaces the multi-item nav. Settings page gets its own `SettingsTopbar` (back arrow → /dashboard, mobile hamburger). Settings page uses `bg-paper` to match the topbar; sidebar keeps `bg-bone`.
- Sign-out moves to the bottom of the settings sidebar (and the mobile drawer). `UserMenu` removed.
- Account moved into the settings sidebar (first item under Workspace). New `AccountPage` (org-name field, `GET`/`PATCH /api/v1/orgs/me`) accepts `extraSections` so cloud can compose its destructive Delete-account UI on top.

**Onboarding wizard**
- New step 1 collects the org name (`OrgNameCard`); existing steps renumbered to 2–4. `useDashboardGate` and `useSetupGate` redirect to /setup when the org name is empty, not just when the agent is unconfigured.
- `invalidateActiveMembershipCache()` exported so the topbar brand refreshes immediately after a rename.

**Team page**
- Row-level Edit per member opens a dialog to rename. Owner/admin can edit anyone; members can edit only themselves. Self-rename also calls `authClient.updateUser({ name })` to sync the Better Auth session.

**Action feedback**
- New `Button` `pending` prop renders a spinning Loader2 and disables the button.
- New `notify` helper wraps `sonner` (`notify.success` / `notify.error` / `notify.info`). Inline `<Card><CardContent text-destructive>` patterns swept across team, channels, agents, end-users, export, api-keys, audit-log, agent-setup-wizard, inbox, suggestions. The InboxErrorBanner export is gone; inbox actions now toast directly.
- Revoke flows (agents, api-keys, end-users) wire `pending` per row and toast success/failure. End-users "no tokens to revoke" is now an `info` toast, not an error.

**Backend**
- `PATCH /api/v1/orgs/me/members/:userId` accepts `{ name? }`. Name edits allowed for owner/admin or self-edit; role edits still owner-only.
- `POST /api/v1/conversations/:id/messages` accepts `claim?: boolean` (default true). Quick-reply flow passes `false` so approving the AI's draft no longer claims the conversation.
- `POST /api/v1/conversations/:id/status` releases the human claim when transitioning to `closed`.
- `/api/v1/inbox` `loadLive` filters closed/spam at SQL via a new `excludeStatuses` option on `listConversations` and `listConversationsByIds`.
- Widget ingest accepts `visitorId` (stable per-browser token); anon end-users key on `anon:<visitorId>` when present, falling back to `anon:<sessionId>` for legacy clients. One end-user per visitor instead of one per session.
- Members controller `PatchMemberDto` accepts `name`; users.name + updatedAt written when editing.

**Chat widget**
- `getVisitorId(channelId)` mints a long-lived browser token, sent on every payload.
- Saved-email confirmation stays inline at its original position (no longer pushed down or pinned).
- Less padding on the saved-state card. Top bar's "Online now" line removed; subtitle renamed from "Chat · instant" to "Online now".
- Header title: "New conversation" when starting fresh, "Conversation" when opening an existing one (subject still wins).

**Agent runtime**
- System prompt forbids placeholders (`[Name]`, `[Phone Number]`, …) — every message must be deliverable verbatim.

**Visual polish**
- All 1px / 2px borders swept to `border-[0.5px]` for hairline rendering on retina (49 files, ~115 occurrences). Topbar bottom border + section dividers + KPI tile outlines all hairline now.
- "Delegated end-user token" → "End-user token" in the Agents settings table.
- "TAKEN OVER" pill swaps the shield icon for a person icon and drops the leading blue dot.
- Conversation drawer's "Close" button now reads "Close conversation".
- Agents table row vertically centers single-line cells against the two-line "End-user token + scopes" cell.

**Settings layout**
- Account redirect target unchanged (`/dashboard/settings/team`); Account is the new first item in the workspace nav group.
