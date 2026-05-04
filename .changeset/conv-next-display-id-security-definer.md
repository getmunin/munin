---
'@getmunin/db': patch
---

Fixes a bug where a second end-user starting a conversation in an org that already has another end-user's conversation would 500 with `conv_conversations_display_uq` collision. `conv_next_display_id(p_org_id)` was running under the caller's RLS context — when called from a delegated end-user token, it only saw that end-user's own conversations and computed `MAX(display_id) + 1` from the wrong baseline, picking values already taken by *other* end-users' rows. The application-layer retry couldn't recover because Postgres aborts the whole transaction after the first INSERT conflict. Marks the function `SECURITY DEFINER` (with a fixed `search_path`) so the per-org sequence is computed against all conversations in the org, regardless of caller tenancy. Added a regression test (`a second end-user can start a conversation after the first`) covering the exact pattern that triggered the bug.
