---
'@getmunin/dashboard-pages': patch
---

Drop the raw model id from a picker option that already has a name.

The option text carried both, reading `Gemma 4 26B (chat, vision) · gemma-4-26b-a4b-it`.
The reasoning was that the id is what actually goes to the provider and what an operator
matches against the provider's catalogue — but it defeats the point of naming the model at
all, and the two longest strings in the row are then the same fact twice. A model with no
name still shows its id through `modelHead`, so nothing becomes anonymous.

`value` on each option was always the id and is untouched, so what gets saved and sent is
unchanged.
