---
'@getmunin/backend-core': minor
'@getmunin/dashboard-pages': minor
---

Search the whole conversation archive from the queue page, not just the rows already loaded.

The search box filtered the queue client-side, over the ~100 open and ~100 closed rows the page happened to have fetched. Anything older, anything on page two, and anything whose only match was a phrase deeper in the thread than the last inbound preview simply did not exist as far as the box was concerned — and because the "Load more" button was wired to the unfiltered open cursor, a search with no hits still offered to load more of a list it was not searching.

`GET /v1/conversations` and `GET /v1/conversations/queue` now take `q`, and `conv_list_conversations` takes the matching `search` argument. One case-insensitive substring is matched against the conversation subject, the customer's name / email / phone (contact or end user), the topic name, and the body of every public message; a bare number, or `#number`, also matches that conversation number. `%` and `_` are escaped, so a term like `100%` is matched literally. Internal notes and drafts are deliberately excluded. Terms over 200 characters are rejected with `conv_invalid`.

The dashboard sends the term (debounced) with whatever filters are set, so a search spans every status unless the status filter narrows it, results paginate through the same cursor as the rest of the queue, and "Load more" now appears only when there really is another page of matches.

Two fixes alongside it: the filter button next to the search box rendered ~18px wide because `aspect-square` takes its width from content inside a stretched flex row — it is now square at both breakpoints — and the queue query is memoized per filter set, so an active "Activity" window no longer rebuilds its `since` timestamp on every render and refetches in a loop.
