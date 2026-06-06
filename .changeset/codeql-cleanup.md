---
'@getmunin/chat-widget': patch
'@getmunin/agent-runtime': patch
'@getmunin/backend-core': patch
'@getmunin/db': patch
---

CodeQL cleanup: drop the `Math.random` session-id fallback in the chat widget (modern browsers always have `crypto.randomUUID`/`getRandomValues`), tighten the HTML-stripping regexes used by the web crawler and widget email fallback so nested/whitespaced `</script>` tags don't slip through, and rejection-sample in `makeId` to remove the modulo bias on the cryptographic random source.
