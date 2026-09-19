---
'@getmunin/backend-core': minor
---

A published article drafts companion posts for every platform the org connected, not just LinkedIn.

`social-companion.sink.ts` hardcoded `linkedin`, so an organisation that connected a
Facebook Page and opted a collection into `socialDraftOnPublish` got LinkedIn drafts and
nothing for Facebook. It now reads the platforms the org holds a connection for and queues
one drafting pass each — separate runs rather than one run proposing both, because the two
platforms want different writing and a failed pass should not take the other down with it.

Making that safe took the dedupe apart. Both guards were keyed on the entry alone: the
"already drafted" query matched any set carrying `sourceRef {type: cms_entry, id}`, and the
curator `dedupeKey` was `social-companion:entry:<id>`. Either one would have let the first
platform through and refused the second. The query now collects the platforms already
drafted for and skips those; the key carries the platform. A LinkedIn set already waiting
no longer stops the Facebook pass, and a repeat of the same entry on the same platform is
still swallowed.

An organisation with no connection at all still gets one LinkedIn pass. Drafts are useful
the moment somebody connects, and an opted-in collection that silently drafts nothing while
an operator is still getting round to Settings → Integrations is worse than a set waiting
in the queue.

Who a post goes out *as* now reaches the drafting agent. The prompt and
`skill://social/draft-companion-posts` both told it the publisher's own name would be on
the post — true on LinkedIn, wrong for a Page, and the fourth place in the codebase to
carry that assumption. The prompt is built per platform, and the predicate behind it is now
one function, `postsAsPage`, which the Slack approval card uses too rather than spelling
out `authorKinds.includes('member')` a second time.

`skill://cms/publish-entry` documents the opt-in, which was only ever described from the
social side — the setting is turned on with `cms_update_collection`, so the operator who
needs to know about it was reading the wrong skill.
