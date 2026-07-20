---
'@getmunin/backend-core': patch
---

Harden the Slack OAuth install flow against install-URL hijacking

Two defenses on `completeInstall`:

- **Session binding for dashboard installs.** The `/v1/slack/install-url` endpoint now sets an httpOnly, `SameSite=Lax` `slack_install_nonce` cookie and embeds the nonce in the signed OAuth `state`; the callback requires the cookie to match. A leaked or intercepted dashboard install URL can no longer be completed by anyone but the initiating browser. MCP-minted install URLs (opened by a human in a fresh browser, no cookie continuity) remain nonce-free by design and rely on the short TTL plus the guard below.
- **Workspace-repoint guard.** `completeInstall` refuses to overwrite an org's existing integration with a *different* Slack workspace (returns `slack_workspace_mismatch`); switching workspaces requires an explicit `slack_disconnect` first. This blocks the high-impact case where a redeemed install URL would repoint an org's mirrored conversations (customer PII) to an attacker-controlled workspace.
