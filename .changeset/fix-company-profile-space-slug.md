---
'@getmunin/core': patch
---

Fix: `COMPANY_PROFILE_SPACE_SLUG` now matches where the web-import handler actually writes the scraped Company profile doc.

Two constants pointed at different KB space slugs:

- `web-import.handler.ts` wrote the "Company profile" doc into space `website-import`.
- `prompts/index.ts` (`COMPANY_PROFILE_SPACE_SLUG`) looked for it in space `imported-from-website`.

Same doc slug (`company-profile`), different space. Result: the PromptResolver's cache lookup never resolved the profile, `prompts.companyContext()` always returned `''`, and the `[Company context]\n…` block was never appended to the chat widget agent's system prompt. End-users asking "what does <company> do?" got generic answers because the scraped profile never reached the agent — even though the doc existed in the KB the whole time.

Aligned `COMPANY_PROFILE_SPACE_SLUG` to `'website-import'` (the value the web-import handler actually uses). No data migration needed.
