---
'@getmunin/backend-core': patch
---

Conversation titles are now written in the customer's language instead of always in English.

The set-topic-and-title curator skill gives chat, SMS and voice conversations a short title, and the chat widget shows that title as the heading of the customer's own conversation. The skill never said which language to use and every example was English, so a customer writing in Norwegian saw an English heading above their chat. The skill and the job prompt now ask for the title in the language the customer wrote in, with a non-English example. Topic names are unaffected: they are org-wide buckets only operators see, and new ones follow the language of the org's existing topics.

Titles already set on existing conversations are not rewritten.
