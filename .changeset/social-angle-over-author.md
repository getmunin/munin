---
'@getmunin/backend-core': minor
'@getmunin/db': minor
---

Lead a social draft with its angle, and drop the suggested author.

A set of variants is one post written several ways, so what a reviewer is choosing between is the *angle*. That already existed: `variantLabel` is specified as the angle the variant takes (`practitioner`, `contrarian`, `story`, `data`), and it becomes `utm_content` on the share link so later click figures say which angle earned the attention. It just wasn't visible anywhere a decision gets made — the dashboard showed it only in the decided feed, after the choice, and the Slack card buried it as a parenthetical serial number.

So the angle now leads: the Slack card headline is the angle rather than the platform, the set parent lists the angles in the thread (you know what the choice is before expanding it), and the dashboard's pending pane shows it in the meta line.

`suggestedUserId` is removed — column, tool inputs, DTO and card line. It named a person, conferred nothing, and was never read by the publish path, so the card naming it had to disclaim itself in the same breath ("suggested author: X · publishing posts it from your own account, not theirs"). A label that needs an immediate correction is the wrong label. Nothing replaces it: a draft carries no owner by design, because whose feed a post lands in is decided by who clicks publish, not by who filed it.

`skill://social/route-a-post-to-a-person` is deleted with it. Stripped of the routing half it was four facts, and the curator job that actually files social drafts could never run it anyway — `TOOL_PREFIXES_BY_URI` does not grant that job `social_list_connected_accounts`, the tool the skill opens by calling. The surviving facts moved next to the operations they affect: the lapsed-LinkedIn-grant explanation (`canRefresh: false` is correct for the self-serve product, not a misconfiguration) and the never-ask-for-a-token rule now sit beside `social_reconnect_required` in `publish-a-reviewed-post`; "file the drafts even when nobody can publish yet" sits in `draft-companion-posts`, where that call is made. `social_list_connected_accounts` stays — it still answers whether anybody can publish at all.
