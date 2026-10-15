---
title: Design an email template
description: Build the org's branded email layout as an MJML template — logo, colours, fonts, footer and unsubscribe link — preview it with real content in both markdown and MJML form, fix the warnings, and save it, optionally as the org default.
audiences: [admin]
---

# Design an email template

An email template is the org's branded layout for outreach email: the logo at the top, the colours and fonts, and a footer with the organization's name and the unsubscribe link. Each message's own content is poured into it at one marked spot. Templates are written in MJML, an open-source markup language that compiles to the table-based, inline-styled HTML that Outlook, Gmail, Apple Mail and dark mode all render consistently. Hand-written email HTML rarely survives those clients; MJML does the hard part.

Templates are stored data, not code. Each org can keep several, for example "Newsletter" and "Changelog", and mark one as the default. A broadcast (`skill://outreach/send-broadcast`) renders through the template it names, else the org default, else a plain built-in layout.

## The contract

A template is a complete MJML document (`<mjml><mj-head>…</mj-head><mj-body>…</mj-body></mjml>`) with placeholders from a fixed list. Anything else in double braces is refused.

| Placeholder | Required | Filled with |
|---|---|---|
| `{{content}}` | exactly once | The message's sections. Must sit directly inside `<mj-body>` or `<mj-wrapper>`, between sections, never inside a column. |
| `{{unsubscribe_url}}` | at least once, in an `href` | The recipient's personal unsubscribe link. |
| `{{org_name}}` | no | The organization's name. |
| `{{subject}}` | no | The email subject. Use it in `<mj-title>`. |
| `{{preheader}}` | no | The inbox preview line. Use it in `<mj-preview>`. |
| `{{name}}` / `{{name\|there}}` | no | The recipient's name. The text after the `\|` is used when the name is unknown. Only `{{name}}` takes a fallback. |

Content comes in two formats:

- **`markdown`** becomes one section containing a single `<mj-text>`. Style it from the template's `<mj-attributes>` (font, size, colour, line height), so plain markdown content picks up the brand without carrying any styling itself.
- **`mjml`** is a fragment of `<mj-section>` or `<mj-wrapper>` elements (no `<mjml>`, `<mj-head>` or `<mj-body>`). Use it for layouts markdown can't express: release cards, a hero image, a two-column feature row, buttons.

Content may use `{{name}}`, `{{org_name}}` and `{{subject}}`, but not `{{content}}` or `{{unsubscribe_url}}`.

**Refused outright**, in templates and in MJML content alike: `<script>`, `<iframe>`, `<object>`, `<embed>`, `<form>` and other form controls, `<base>`, `<meta>`, `<link>`, inline event handlers (`onclick=`, `onerror=` …), `javascript:`, `vbscript:` and `data:` URLs, CSS `@import`, CSS `expression()`, and `<mj-include>`. Declare web fonts with `<mj-font>`. Host images at a public https URL; a CMS asset works well (`cms_upload_asset_from_url`, then use its `url`). Inline `data:` images are refused because Gmail and Outlook block them.

Validation runs MJML in strict mode. An error names the line it is on: `template line 18 ({{content}}): mj-section cannot be used inside mj-column` means the `{{content}}` marker on line 18 sits inside a column and has to move out to body level.

## Procedure

1. **Collect the brand.** Logo URL (an https image, ideally a PNG about twice the width it is shown at), one or two brand colours, the font, the legal name and the postal address the footer should carry. Ask the operator for anything you can't read off the org's website. Don't guess a colour.
2. **Draft the MJML.** Start from the example below and change it, rather than writing from a blank page. Keep the body 600px wide (the MJML default) and give every `<mj-image>` an `alt`. Prefer a system font stack (`Helvetica, Arial, sans-serif`). Gmail ignores web fonts, so if the brand uses one, declare it with `<mj-font>` and always list web-safe fallbacks after it.
3. **Preview before saving.** Call `outreach_preview_email_template` with the draft as `mjml` and realistic content. Preview it twice: once with `format: "markdown"` (a heading, two paragraphs, a list and a link) and once with `format: "mjml"` (a card or two). The result carries the final `html`, the plain-text `text`, `htmlBytes` and `warnings`. Read the warnings. Above 90KB Gmail is close to clipping the message, which hides the footer and its unsubscribe link.
4. **Show the operator.** Describe the layout, and offer the rendered `html` if their client can display it. The plain-text part is what screen readers and text-only clients get, so check that it reads in order.
5. **Save it** with `outreach_create_email_template`. Pass `isDefault: true` when it's the org's first template or the operator says it should be the house style. Saving re-runs the same validation, so a template that previewed cleanly saves cleanly.
6. **Iterate** with `outreach_update_email_template`. New MJML is validated first, and nothing is saved if it fails, so the stored template is never broken.

## Example template

```xml
<mjml>
  <mj-head>
    <mj-title>{{subject}}</mj-title>
    <mj-preview>{{preheader}}</mj-preview>
    <mj-attributes>
      <mj-all font-family="Helvetica, Arial, sans-serif" />
      <mj-text font-size="16px" line-height="1.6" color="#1c1b19" />
      <mj-button background-color="#1c1b19" color="#ffffff" border-radius="8px" font-weight="600" />
    </mj-attributes>
  </mj-head>
  <mj-body background-color="#f6f5f2">
    <mj-section padding="24px 0 8px">
      <mj-column>
        <mj-image width="120px" src="https://cdn.example.com/acme-logo.png" alt="Acme" />
      </mj-column>
    </mj-section>
    <mj-wrapper background-color="#ffffff" border-radius="12px" padding="8px 0">
      {{content}}
    </mj-wrapper>
    <mj-section>
      <mj-column>
        <mj-text font-size="12px" color="#6b6862" align="center">
          {{org_name}} · Eksempelgata 1, 0001 Oslo<br />
          <a href="{{unsubscribe_url}}" style="color:#6b6862">Unsubscribe</a>
        </mj-text>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>
```

## Example MJML content: a release card

```xml
<mj-section>
  <mj-column>
    <mj-text><h1 style="margin:0">What's new in October</h1></mj-text>
    <mj-text>Hi {{name|there}}, three things shipped this month.</mj-text>
  </mj-column>
</mj-section>
<mj-section>
  <mj-column>
    <mj-image src="https://cdn.example.com/voice-notes.png" alt="Recording a voice note in the inbox" border-radius="8px" />
    <mj-text><h2 style="margin:0">Voice notes</h2>Record a note straight from the inbox and it lands on the conversation.</mj-text>
    <mj-button href="https://example.com/changelog#voice-notes">Read more</mj-button>
  </mj-column>
</mj-section>
```

## Don't

- **Don't put content in the template.** Anything that changes between messages, such as headlines, offers or dates, belongs in the content. A template that reads well with only "Hello" in it is the right shape.
- **Don't hide the unsubscribe link.** Keep it in the footer with readable contrast. Validation only checks that it is there. Making it hard to find is the operator's legal risk and a spam-folder signal.
- **Don't build the email out of images.** Text set in an image disappears when images are blocked, which many clients do by default, and it reads as spam. Use images for pictures and keep the words in text.
- **Don't reach for `<mj-raw>`** unless MJML has no component for what you need. Raw HTML skips the client-compatibility work MJML exists to do.
