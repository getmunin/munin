---
'@getmunin/dashboard-pages': patch
---

Journeys pages keep their header while loading and match the console layout: the list shows skeleton rows under the real table header, the detail page keeps its back link with skeletons for the title, tabs and graph. The detail header now uses the standard back arrow, shows status and version as a quiet line under the description, and keeps only Pause/Resume and Publish as actions; the graph toggle and Edit draft sit on the tabs row.

The Report tab is rebuilt on the console's layout: headline tiles for people, goal conversion, holdout and lift; a steps table with arrival bars, ordered by arrivals with exit and goal steps last; serif section heads with the 30-day window shown as a muted suffix; exits as bars; and run integrity collapses to one reassuring line unless something is off.
