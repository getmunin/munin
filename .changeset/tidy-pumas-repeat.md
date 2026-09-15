---
'@getmunin/backend-core': patch
---

Keep the payload of a forward in the message body when the person forwarding is also the sender of the mail they forward.

Quote reconstruction asked one question to answer two: `resolveForwardOrigin` decides who the contact is, and its answer was also used to decide whether a header block in the body opens a forwarded message or a quoted reply. Those come apart whenever a forward changes nothing about identity — someone forwarding a mail they sent, or one that was addressed to them. The origin resolves to `direct`, the quote parser is told "not a forward", and the `From:/Date:/Subject:/To:` block below `---------- Forwarded message ---------` is read as thread history. The stored body is then the marker line alone and the whole question the customer asked lands in the collapsed history, where an agent drafting a reply reports the message as truncated and asks them to send it again.

A forward marker whose words say "forwarded" is now positive evidence on its own, independent of who sent what: it keeps the block below it in the body whatever the origin resolved to. The gate stays for markers a client also prints above a quoted reply — `-----Original Message-----` and Outlook's rule of underscores — which is what #970 turned on. For those, a subject that opens with a forward prefix (`Fwd:`, `VS:`, `WG:`, …) now counts as the same evidence, so an Outlook forward of one's own mail keeps its payload too; that signal also holds the quote-header scan and the signature splitter off the marker line, since both would otherwise cut the forwarded text away further down the pipeline.
