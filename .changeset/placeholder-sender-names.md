---
'@getmunin/backend-core': patch
'@getmunin/db': patch
---

Show the address when a sender's display name is a placeholder

Mail whose `From` display name carries no letters or digits — `? <name@example.com>`, from a
client that fills the field rather than leaving it out — stored that punctuation as the
contact's name. Every surface that prefers a name over an address then showed it: the queue
row read `? — Missing last message`, the conversation header `? <name@example.com>`, and each
message bubble was signed `?`.

Inbound parsing now treats a display name with no letter or digit as absent, on both the
direct `From` header and the `From:` line read out of a manually forwarded body, so the
contact keeps a null name and every one of those surfaces falls back to the address it
already falls back to for mail that omits the name entirely.

Migration 0093 clears the names already stored the same way, across conversation contacts,
end users and CRM contacts. The predicate matches only names made up entirely of whitespace
and punctuation, so names in any script are untouched.
