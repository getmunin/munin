---
'@getmunin/backend-core': patch
---

Pin the LinkedIn API version to an active release.

`DEFAULT_API_VERSION` shipped as `202509` — September **2025**, a year before
the feature landed. LinkedIn supports a version for a minimum of one year and
`202509` is past that window (the oldest still-supported release is `202510`,
sunsetting 2026-10-15), so `POST /rest/posts` answered every publish with
`426 NONEXISTENT_VERSION: Requested version 20250901 is not active`. The 8-digit
number in that message is LinkedIn expanding our 6-digit header to the first of
the month, which is why the error does not obviously point at our constant.

Nothing published while this was live: the draft went to `failed` with the 426 in
`last_error`, the Slack card closed with "The platform refused the post", and the
reason never reached the logs — `publishDraft` throws `BadGatewayException`, an
`HttpException`, and there is no exception filter, so a 502 is not logged at all.

`apiVersion()` now pins `202609`, and `apiVersion` gained a test asserting the
pinned default is between 0 and 11 months old. That fails CI a month before
LinkedIn sunsets whatever is pinned, which is the only signal that arrives
before a customer's post is refused.
