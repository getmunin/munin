---
'@getmunin/backend-core': minor
'@getmunin/dashboard-pages': minor
---

Spam stays out of the inbox unless you ask for it. The unfiltered inbox already hid spam, but the moment you searched or set any filter, such as a channel, spam conversations came back mixed into the results. The filter panel still read "Any status" and "Any origin" over a list that left them out, so picking "Known junk senders" revealed conversations that "Any origin" had not shown.

Now a search or filter leaves spam out as long as the status filter is at its default, and that default is labelled "All except spam". Choosing the status "Spam" shows it. Picking the origin "Known junk senders" sets the status to "Spam" as well, so the filter receipt shows both and it is clear why spam is on screen.

`GET /v1/conversations` and `GET /v1/conversations/queue` take a new `excludeStatus` parameter, one conversation status to leave out of the results. An unknown value is refused with `conv_invalid`. `conv_list_conversations` is unchanged.
