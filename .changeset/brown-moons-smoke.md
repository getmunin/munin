---
'@getmunin/backend-core': patch
---

Reconstruct the quoted history of an Apple Mail or Gmail reply, not just an Outlook one.

Two mechanisms read quoted text and they had different coverage. `stripQuotedReplyText` removes the quote from the stored body and understands both shapes — the attribution line (`On 15 Sep 2026, at 09:37, Support <hello@example.com> wrote:`, plus its Nordic, German, French, Polish, CJK and other equivalents) and the Outlook header block. `parseQuotedThread`, which builds the turns behind "Earlier in this thread", understood **only** the header block: a `From:` line with at least two of `To:` / `Date:` / `Subject:` / `Cc:`.

So a reply from Apple Mail or Gmail had its quote correctly stripped from the body but never reconstructed, and the panel simply did not appear. Outlook replies worked, which is why this went unnoticed — the feature was built against Outlook in the first place.

`parseQuotedThread` now falls back to attribution-line parsing when no header block is found, splitting turns at each attribution and stripping one `>` marker level per nesting depth. Header-block parsing is unchanged and still wins when a message carries both. `to`, `date` and `subject` are left null for attribution quotes rather than guessed, since the line's format varies per client and language; the sender is taken from the address in the line, with the display name when one is present.

The shared attribution patterns move to `email/attribution.ts` so both readers use one list — `reply-history.ts` keeps its separator patterns (`-----Original Message-----` and friends), which mark a quote boundary but never begin a turn.
