---
title: Draft a changelog broadcast
description: Turn what shipped since the last changelog email into a customer-facing broadcast. Collect the changelog entries from the CMS (or the knowledge base), choose the few that matter to customers, write them up as release cards, and file the draft for approval.
audiences: [admin]
---

# Draft a changelog broadcast

A changelog email tells existing customers what changed for them since the last one. This skill drafts it. Sending follows `skill://outreach/send-broadcast`: a person reviews the draft, sends themselves a test, and approves it. You never approve it.

## 1. Find what shipped, and since when

- **Since when.** `outreach_list_broadcasts` with `status: "sent"` lists earlier broadcasts. The newest changelog one's `decidedAt` is where this one picks up. If there is none, ask the operator for a start date rather than guessing.
- **What shipped.** Most orgs keep the changelog as a CMS collection. Find it with `cms_list_collections` (names like "changelog", "releases", "updates", "news"), then `cms_list_entries` for published entries from the start date on, and `cms_get_entry` for each one's full text, image and URL. If the changelog lives in the knowledge base instead, use `kb_search`. If you can't find a source, ask. Don't reconstruct releases from memory or conversation history.

## 2. Choose and write for customers

- **Pick three to six items** that change something a customer will notice: new capabilities, visible improvements, fixes to problems they reported, changes they have to act on. Leave out internal refactors, dependency bumps and anything behind a flag they can't use. Close with a link to the full changelog.
- **Lead with the benefit, in their words.** "Record a voice note straight from the inbox" beats "Added audio capture to the composer". One or two sentences each. No ticket numbers, internal code names or team names.
- **Anything they must do goes first**, such as a deprecation, a price change or a required setting, before the new features.
- **Write in the customers' language.** A Norwegian customer base gets Norwegian. If the segment is mixed, ask the operator whether to draft one broadcast per language segment.

## 3. Build the content

Use `format: "mjml"`, with a short intro section and one section per item. Each item gets a heading and a sentence or two, the entry's image when there is one (with an `alt` that describes it), and a button to the entry:

```xml
<mj-section>
  <mj-column>
    <mj-text><h1 style="margin:0">What's new in October</h1></mj-text>
    <mj-text>Hi {{name|there}}, here is what changed for you this month.</mj-text>
  </mj-column>
</mj-section>
<mj-section>
  <mj-column>
    <mj-image src="https://cdn.example.com/voice-notes.png" alt="Recording a voice note in the inbox" />
    <mj-text><h2 style="margin:0">Voice notes</h2>Record a note straight from the inbox; it lands on the conversation for everyone to hear.</mj-text>
    <mj-button href="https://example.com/changelog/voice-notes">Read more</mj-button>
  </mj-column>
</mj-section>
```

Image URLs must be public https URLs; CMS asset URLs work. For two or three short items, `format: "markdown"` with a heading per item reads just as well.

## 4. File the draft

Call `outreach_create_broadcast` with:

- `name`: "Changelog — October 2026", so the next run can find this one.
- `segmentId`: the customers segment the operator uses for product news. Confirm which one if there are several.
- `channelId`, `emailTemplateId` as in `skill://outreach/send-broadcast`.
- `subject`: specific, e.g. "Voice notes, faster search and a new export". A bare "October update" tells the reader nothing.
- `preheader`: the one line that makes someone open it.

Then report back with the items you chose and why, the ones you left out, the audience numbers, and the preview. Point out anything you weren't sure about. The operator takes it from there: test send, edits, approval.
