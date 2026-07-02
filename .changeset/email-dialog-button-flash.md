---
'@getmunin/dashboard-pages': patch
---

fix(channels): stop the email channel dialog button label flashing on cancel

The "Edit email channel" dialog derived its edit/create state live from the
`editChannel` prop. Cancelling cleared that prop before the dialog's close
animation finished, briefly re-rendering the still-mounted dialog in create
mode (the footer button flashed from "Save changes" to "Create"). The edit
state is now frozen while the dialog is open.
