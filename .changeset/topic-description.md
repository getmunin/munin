---
'@getmunin/backend-core': minor
'@getmunin/dashboard-pages': minor
'@getmunin/db': minor
---

Topics carry a description — what belongs in them, in the operator's words

Picking a topic is an automation decision, not just filing: a topic can force `draft_only` or `off` on every conversation tagged with it. Until now the classifier made that decision from a name and its kebab-case slug — the same word twice. Nothing told it where an org draws the line between Support, Technical and Security, what its own vocabulary means, or that an existing topic already covers the case it was about to create a near-duplicate for.

`conv_topics` gains a nullable `description`. It is returned by `conv_list_topics` and `conv_list_topic_automation`, settable on `conv_create_topic`, and editable through the new `conv_update_topic` tool or the topic editor on the automation page. The slug stays fixed at creation — it is how exports and imports address a topic.

`skill://conv/set-topic-and-title` now reads descriptions ahead of names, treats a description that rules a case out as decisive, and writes one for every topic it creates. It deliberately does not edit descriptions on topics it did not create: one conversation is not enough evidence to redraw a boundary an operator drew.
