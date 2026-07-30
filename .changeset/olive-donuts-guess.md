---
'@getmunin/backend-core': minor
'@getmunin/inspector-app': minor
'@getmunin/dashboard-pages': patch
---

Outbound calls and text messages are approved only by a person in the dashboard

A proposal whose campaign runs on a voice or SMS channel can now only be approved by a signed-in dashboard user. `outreach_approve_proposal` refuses every other caller — an MCP agent, an unrestricted admin API key on the control plane, a curator, the Slack approval button — and the proposal stays `pending`. Email approval is unchanged, including by agents and admin keys.

The check lives in `OutreachService.approveProposal`, so it holds regardless of which surface the call arrives through. It is not an MCP tool-visibility hint: hosts that don't implement MCP Apps still list the tool, and calling it on a voice proposal fails there too.

Slack declines these in-thread with a pointer to the dashboard rather than surfacing a service error. The Inspector panel drops the approve button for voice and SMS proposals — Dismiss stays, since dismissing sends nothing — and says where the call is actually placed.

Quiet hours and blackout dates are now enforced when a call or text is approved. They were previously stored on the campaign and consulted only when listing due follow-ups, so nothing stopped a call at 3am. `cadenceRules` gains an optional `quietHoursTimezone` (IANA, validated) that quiet hours and blackout dates are read in; without it they are read in UTC, which is not what a Norwegian campaign means by "no calls before 08:00".
