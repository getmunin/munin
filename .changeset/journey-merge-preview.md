---
'@getmunin/backend-core': minor
'@getmunin/dashboard-pages': minor
---

Journey messages under review now show what the recipient will actually get. Merge fields such as `{{contact.custom_fields.first_name|der}}` are only filled in at send time, so the review pane used to show the raw tags. Outreach proposals now carry a `preview` with the subject and body merged for that contact, using the same rules as the send path (org name in email only, voice openings left as written). `preview.unfilled` lists the fields the contact is missing and the fallback that will be used instead. The review and scheduled panes show the merged text, with a notice for missing fields; editing still shows the raw merge fields.
