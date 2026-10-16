---
'@getmunin/backend-core': minor
'@getmunin/db': minor
---

Organizations can now keep branded email templates for outreach, written in MJML.

A template is a complete MJML document holding the org's layout: logo, colours, fonts, and a footer with the organization's name and the unsubscribe link. Each message's content goes in at one marked spot. Templates are stored per organization in the new `outreach_email_templates` table (migration `0118_outreach_email_templates`), and one of them can be the org default. They are compiled with MJML 5 into the table-based, inline-styled HTML that Outlook, Gmail and Apple Mail render consistently.

New admin tools, with matching endpoints under `/v1/outreach/email-templates`:

- `outreach_create_email_template`, `outreach_update_email_template`, `outreach_get_email_template`, `outreach_list_email_templates` and `outreach_delete_email_template` manage templates. Names are unique per org, and marking a template as default clears the previous one.
- `outreach_preview_email_template` renders sample content through a saved template, through unsaved MJML, or through the org default. It sends nothing and returns the final HTML, a plain-text part, the size in bytes, and warnings.

Templates use a fixed set of placeholders: `{{content}}` (required, exactly once, where sections may go), `{{unsubscribe_url}}` (required, in an `href`), and optionally `{{subject}}`, `{{preheader}}`, `{{org_name}}` and `{{name}}` / `{{name|fallback}}`. Unknown placeholders are refused. Content comes as markdown, which the template styles as one text section, or as an MJML fragment of sections for richer layouts such as release cards. Values are HTML-escaped when they are filled in.

Validation runs MJML in strict mode and reports the template or content line an error is on, without exposing server paths. Templates and MJML content that contain scripts, iframes, forms and other form controls, `<base>`, `<meta>`, `<link>`, inline event handlers, `javascript:`, `vbscript:` or `data:` URLs, CSS `@import` or `expression()`, or `<mj-include>` are refused. File includes are switched off. Warnings flag images without alt text, and HTML above 90KB, since Gmail clips messages above 102KB and the cut hides the unsubscribe footer.

A new skill, `skill://outreach/design-email-template`, walks an agent through collecting the brand, drafting the MJML, previewing it with both content formats, and saving it.

Nothing is sent through a template yet. This lays the groundwork for sending one approved message to a whole segment.
