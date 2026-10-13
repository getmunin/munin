---
"@getmunin/agent-runtime": patch
"@getmunin/core": patch
"@getmunin/dashboard-pages": patch
---

Agent replies written in HTML no longer reach customers as literal tags. Some models answer with `<ul>`, `<li>`, `<strong>` or `<p>` even when asked for Markdown, and every channel escapes raw HTML on purpose, so an approved draft arrived in the customer's inbox or chat widget as visible markup. The agent runtime now converts the HTML models commonly produce (paragraphs, line breaks, ordered and unordered lists including nested ones, bold, italics, headings, links and inline code) into Markdown before a reply is drafted, translated, audited or sent. Text without those tags is left untouched, as is anything inside code spans or fenced code blocks. Links keep only `http`, `https`, `mailto` and `tel` targets, and tags outside that set stay as they are for the channel renderer to escape.

The default email channel descriptor no longer says the reply "is rendered as HTML", which smaller models read as an invitation to write HTML. It now asks for Markdown and explicitly rules out HTML tags, and the chat descriptor gains the same rule. Organizations keep the descriptor seeded when they were created, so existing ones only pick this up by editing `channel-email` and `channel-chat` in their `agent-runtime` space.

The read-only draft preview in the inbox now renders Markdown the same way the sent message does, instead of showing the source with its asterisks and list markers.
