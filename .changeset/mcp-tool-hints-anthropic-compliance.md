---
'@getmunin/backend-core': patch
---

Make every MCP tool declare exactly one of `readOnlyHint: true` / `destructiveHint: true`, as required by Anthropic's MCP directory submission policy.

Anthropic's review process expects each tool to be unambiguously read-only or destructive so Claude can auto-permission reads while still prompting for writes. Most tools already carried the hints, but ~100 writes only had `destructiveHint: false` (the default) and a handful of writes in `system-alerts` and `feedback` had no hints at all. This sweep flips every write to `destructiveHint: true` and adds explicit hints to `system_alerts_acknowledge`, `system_alerts_resolve`, `feedback_create`, `feedback_approve`, and `feedback_vote`.

Adds a registry-level integration test (`tools-smoke`) that boots the full Nest app and asserts every admin tool sets exactly one of the two hints, plus a name-length check against Anthropic's 64-character directory limit, so regressions fail CI instead of slipping through review.

No behavior change for callers — the `/v1/public/mcp-tools` controller already derived a richer `danger` flag from these hints, so consumers will now see `danger: 'destructive'` where they previously saw `danger: 'writes'` for create/update operations.
