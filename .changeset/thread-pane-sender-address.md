---
'@getmunin/dashboard-pages': patch
---

Show the sender's email address beside their name in the conversation thread pane

The pane header named the contact but not the address the mail came from, which matters most
precisely when several people at one company are in the same campaign. The sub-line now reads
`Bang, Terje <terje.bang@post.no>`, and falls to its own line when the conversation has no subject
so the address never lands inside the headline. A contact whose only identity is the address still
shows it once, not twice.
