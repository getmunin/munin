---
'@getmunin/chat-widget': patch
---

Fix anonymous→identified chat carry-over: the widget now claims a pre-existing anonymous session on boot when configured with a verified identity (`data-external-id` + `data-user-hash`). Previously it set the in-memory identity for reads but never called `identify`, so the backend's leak-protection returned empty history for the still-anonymous session — a conversation started anonymously (e.g. on a marketing site) was invisible after logging in until the visitor sent a new message. The claim now runs once on connect, before history is loaded.
