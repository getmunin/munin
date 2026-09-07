---
'@getmunin/dashboard-pages': patch
---

On a phone you can no longer send a draft you were never shown

The mobile review pane offered Approve & send as its primary action the moment a draft
existed, but the draft itself appeared nowhere on that screen: it lives in the composer
textarea, and on mobile the composer is collapsed to a bar. The thread doesn't render it
either — pending drafts are filtered out of the message list. So the one-tap path sent an
agent-written reply to a customer sight unseen, and the only way to read it first was to
notice that the secondary "Edit draft" button happened to open the full-screen editor.

The collapsed bar now carries a single full-width Review draft button. Approve & send and
Reject draft both live in the editor it opens, where the text is on screen — a verdict on
a draft is only reachable from a screen showing the draft. Rejecting blind was the quieter
half of the same problem: a reject counts against the topic's approved-unedited share, so
it moves the auto-send gate on evidence nobody read.

The no-draft state gets a matching button, in place of the bar styled as a text input. It
read as somewhere to type, which on a phone it never was — tapping it opened the editor. It
now says what it does and carries the same arrow: Write reply, or Continue reply when one
is already in progress, so half-written text stops being invisible behind a placeholder.
Ask for a draft sits beside it unchanged, and while the agent works the button carries the
Thinking / Writing state instead.

The editor's own gutters line up while we're here. Its header sat at 16px and the
reply/note tab row under it at 20px, a step visible against the textarea below (16px) — the
tab row and the action-failure banner were the only two strips in the footer that hadn't
been given a mobile value, so they kept the desktop one at both sizes. Both are 16px on
phones and 20px from `md` up now, and the overflow-menu trigger is pulled out by its icon
button's own inset so its glyph aligns with the close control above it.

Opening the editor onto an unedited draft no longer focuses the textarea. Focus raises the
keyboard, which covers most of the text you opened the screen to read; you get the keyboard
by tapping into the draft, which is also the moment you meant to edit it. Every other way
in — the note tab, an empty composer, a draft you have already touched — focuses as before.
