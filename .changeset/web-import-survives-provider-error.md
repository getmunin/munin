---
"@getmunin/agent-host": patch
---

Website import no longer fails the whole job when company-profile generation hits an LLM provider error (e.g. invalid credentials). The crawled pages are imported regardless — the optional profile step is skipped, a warning is logged, and the job completes successfully.
