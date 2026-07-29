---
'@getmunin/core': patch
---

Fix the bot user-agent filter missing every crawler whose name ends in "bot".

`BOT_UA` was `/\b(bot|crawler|spider|…)\b/i`. The leading `\b` requires a non-word character before the token, so `Googlebot/2.1`, `bingbot/2.0`, `GPTBot`, `ClaudeBot`, `Amazonbot`, `AhrefsBot`, `SemrushBot` and `Bytespider` all sailed through — i.e. the naming convention every real crawler uses. Only the separated forms (`compatible; bot`, `Slackbot-LinkExpanding`) were caught, and the full Googlebot UA matched by accident because it contains `/bot.html`.

Dropping the leading boundary catches suffixed names while the trailing `\b` still rejects words that merely start with a token (`Botanical`). `looksLikeBot` strips known device brands that end in a bot token — currently Cubot phones — before testing, so real Android traffic isn't dropped; a crawler UA that also names such a device is still flagged.

Affects `/v1/a/t`, `/v1/a/v`, `/v1/a/s` and the email-open pixel. Expect page-view and email-open counts to drop where crawlers and link-preview prefetch were previously being counted as readers. Agents with no matching token at all (`facebookexternalhit`, `WhatsApp`, `meta-externalagent`) are still counted; catching those needs a vendor name list, which this does not add.
