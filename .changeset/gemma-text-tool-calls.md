---
'@getmunin/agent-runtime': patch
---

Tool calls a model writes into its reply as text now run instead of reaching the customer. Gemma 4 sometimes ends a reply with the call spelled out, for example `show_products(productRefs=["SL-V4-PIPE"])`, rather than making it through the API. The widget then showed that line to the customer, and the product cards never appeared. In a replay of three widget product questions against `gemma-4-26b-a4b-it`, 41 of 233 final replies did this, and changing thinking or temperature settings did not lower the rate.

The agent loop now recognizes a call at the end of a reply in the Python-style form, in Gemma's native `call:name{…}` form (with or without its special tokens), and inside inline code or a trailing code fence. It runs the call as if the model had made it properly and removes it from the reply. Only tools offered in that turn are recognized, only when the calls are the last thing in the reply, and only when the arguments parse completely, so a reply that just mentions a tool is left alone. If the model writes nothing after the recovered call runs, the text before the call becomes the reply. Each recovery is logged with the model name, so it is visible how often a model needs it.
