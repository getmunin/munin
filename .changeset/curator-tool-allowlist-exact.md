---
'@getmunin/types': minor
'@getmunin/agent-runtime': minor
'@getmunin/agent-host': minor
---

Match curator skill tool allow-lists by exact tool name, and refuse to run a skill that has no allow-list.

The allow-list that sandboxes each background skill job compared tool names by prefix, so an entry such as `conv_set_topic` also admitted every longer tool whose name began with it (`conv_set_topic_automation`, an org-wide automation setting the topic job was never meant to touch). A tool is now admitted only when its name is listed exactly, in both the tool list the model sees and at call time.

A skill job with no allow-list entry, or an empty one, used to run with the full admin tool surface. It now fails with the non-retryable `no_tool_allowlist` reason instead. Every skill in `KNOWN_SKILL_URIS` already has an entry, and a catalog test keeps it that way and checks that every listed name is a registered tool.

Renames, to match the exact semantics:

- `toolPrefixesFor` → `allowedToolsFor` (`@getmunin/types`); the map is exported as `TOOLS_BY_URI`.
- `withAllowedToolPrefixes` → `withAllowedTools` (`@getmunin/agent-runtime`). An empty list now exposes no tools instead of all of them.
- `SkillPassOptions.allowedToolPrefixes` → `allowedTools`; runners that call `runSkillPass` directly must pass it or the pass is skipped.
