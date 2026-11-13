---
"@getmunin/dashboard-pages": patch
---

Social post and CMS entry reviews now share one preview look. The social preview sits in the same full-width backdrop and browser-style frame as the CMS preview, with a top bar naming where the post goes and who it goes out as ("LinkedIn · as Acme") instead of a URL. The post itself stays light, as the platform shows it, inside a frame that follows the dashboard theme.

The social pane's caveats are now proper notices: the publish warning ("Munin cannot take it back") and the notes about where the picture comes from sit above the preview, and a linked page that couldn't be read gets a warning notice and a dot on the Preview tab, as a failed CMS preview does. The publish warning now names the platform properly ("LinkedIn", not "linkedin").

On the Review page on mobile, a social draft's header now collapses like every other item's instead of taking up the top of the screen.

The CMS pane's footer now uses the shared footer layout every other review pane uses, and its field values and editors use the same text size as the other panes.
