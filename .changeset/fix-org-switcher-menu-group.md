---
'@getmunin/dashboard-pages': patch
---

Fix the org switcher dropdown throwing `Base UI error #31` (MenuGroupRootContext missing) when opened. Wrap the label, separator and items in a `<DropdownMenuGroup>` so `Menu.GroupLabel` has the group context it now requires under base-ui 1.4.
