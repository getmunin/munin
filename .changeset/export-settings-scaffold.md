---
'@getmunin/dashboard-pages': minor
---

Export the settings scaffold so an embedder can match the settings design.

`AccountPage` takes an `extraSections` slot and renders it inside its own
`SettingsColumn`, but the primitives that give every other settings section its
shape — `SettingsSection`'s serif heading, right-aligned mono meta and hard rule
— were internal. An embedder filling that slot could only approximate them, and
`@getmunin/ui`'s `SectionHead` is deliberately a different thing: a softer
`border-rule-soft` rule, `pb-3`, `items-end` and a `md:text-2xl` step-up. Close
enough to look like a mistake rather than a variant.

So the slot existed but nothing could be styled to sit in it. The scaffold is now
public: `SettingsColumn`, `SettingsSection`, `SettingsLabel`,
`SettingsFieldNote`, `SaveButton`, `HairlineRow`, `PickerRow`, `CheckboxRow` and
the three measure constants. Presentation only — no behaviour moves and no
existing import path changes, since the pages already reach these through the
module's own relative path.
