---
"@getmunin/backend-core": patch
---

conv: strip signatures that are a trailing contact block with no closing greeting

Inbound emails whose signature is a bare contact block (e.g. an Outlook/Apple Mail HTML-table signature with no "Best regards" sign-off) could survive the cleanup pass when the real reply was short. Both the `strip-email-signature` curator skill and the `conv_strip_message_signature` tool refused to remove a block that was more than half the body, so a one-line reply followed by a large signature kept the signature.

`conv_strip_message_signature` now allows a cut past the 50% guard when the caller supplies a `signatureText` that matches the removed trailing portion and carries two or more contact-info hints (email, phone, address, URL). The skill is updated to recognise greeting-less contact blocks and to always pass `signatureText` when the signature dominates the body.
