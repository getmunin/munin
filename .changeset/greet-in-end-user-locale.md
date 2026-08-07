---
'@getmunin/agent-runtime': patch
---

Generate the widget opening line in the visitor's language. The greet turn seeds an empty conversation with a synthetic instruction, and that instruction was always English with no mention of the visitor's locale — so the model, told only to "match the user's language", matched the English seed and greeted in English even when the widget ran in Norwegian. The seed now embeds `endUserLocale` (already captured from the widget and stored on the end user) and asks for the greeting in that language. The locale is end-user-supplied, so it is only embedded when it parses as a BCP-47-shaped tag; anything else falls back to the old wording, keeping free-text out of instruction position.
