---
'@getmunin/agent-runtime': patch
---

Fix website import finding zero pages on sites behind Cloudflare's managed AI-bot block.

`parseRobots` ignored `Allow:` directives entirely and decided whether a `User-agent:` line started a new group by checking only whether the current group had disallows. Cloudflare's managed block opens with a `User-agent: *` group whose sole rule is `Allow: /`, immediately followed by `User-agent: Amazonbot` / `Disallow: /`. The `*` group looked rule-free, so `Amazonbot` was folded into it and its `Disallow: /` was applied to `*` — every URL on the site was skipped as `robots_disallow` and the import reported that it found no pages to import.

Group continuation now keys off whether any rule line (`Allow` or `Disallow`, including an empty-valued one) has been seen since the last `User-agent:`. `Allow:` is parsed and applied with RFC 9309 longest-match precedence, with `Allow` winning ties, and patterns support `*` wildcards and the `$` end-of-path anchor.

The crawler's User-Agent changes from `MuninOnboardingBot/1.0 (+https://getmunin.com/bot)` to `Munin-Crawler/1.0 (+https://getmunin.com)`. The crawl serves the `kb_import_website` tool and the scheduled re-crawl as well as first-run onboarding, so the old token named only one of its three callers, and the old `+` URL was a 404. Site owners targeting the crawler in robots.txt should use `User-agent: Munin-Crawler`.
