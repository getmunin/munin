---
'@getmunin/backend-core': minor
'@getmunin/dashboard-pages': minor
---

Add a strict option for MCP pseudonymization: "Withhold message text until names are checked". With it on, a pseudonymized connection gets a message's free text — body, quoted thread, attachment names — only after name detection has checked it, and a conversation's subject and preview only once every message in it has been checked; until then the text reads `[WITHHELD: not yet checked for names]` while ids, authors, timestamps and contact tokens stay. Off by default. Results report it in `_meta["munin/pii"]` (`withholdUncheckedText`, `withheld`).

The Privacy page now says when names of people who aren't the org's contacts can still reach MCP results — while name detection works through history, or always when it isn't running — and asks for confirmation before turning strict mode on, spelling out that without name detection no message text is returned at all. The consent screen carries the same notice.
