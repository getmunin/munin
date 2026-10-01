---
'@getmunin/agent-runtime': patch
---

Language detection on ingest now works with reasoning models. The detection call capped the answer at 64 output tokens, and a reasoning model such as gpt-oss-120b spends that whole budget thinking, so it was cut off before writing the language tag. Every new conversation then stayed on "Detecting language…" until a teammate opened it and the translation pass set the language instead. The cap is now 1024, and a detection that runs out of tokens before answering logs that, instead of the vaguer "gave no language tag".
