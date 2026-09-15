---
'@getmunin/backend-core': patch
---

Convert Slack mrkdwn to Markdown on inbound thread replies.

Slack's Events API delivers a message's `text` as mrkdwn, not as what the operator sees in the composer: an emoji arrives as `:slightly_smiling_face:`, bold as `*bold*`, a link as `<url|label>`, a mention as `<@U024BE7LH>`, and `<`/`>`/`&` entity-escaped. That text was stored verbatim, so a customer read the shortcode instead of the emoji. It now goes through a `mrkdwnToMarkdown()` pass — the inverse of the existing `markdownToMrkdwn()` used on the way out — covering emoji (including `:skin-tone-N:` modifiers), emphasis, bullets, both blockquote forms, links, user/channel mentions and broadcasts.

Unknown shortcodes are left untouched, so a custom workspace emoji survives as its shortcode rather than being dropped. The `:shortcode:` table is generated from iamcal/emoji-data by `scripts/generate-slack-emoji.mjs`; `!assign` is still parsed off the raw Slack text, so thread commands are unaffected.
