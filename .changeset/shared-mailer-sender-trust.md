---
"@getmunin/backend-core": minor
---

fix(conv): keep organizations' email off the shared sender's own domains, and stop emailing widget addresses nobody verified

An email channel with `outbound.provider: 'mailer'` sends through the deployment's shared mailer, and its `fromAddress` only had to be a valid email address. Any organization could therefore send mail that passed the shared sender's DKIM as the deployment's own addresses, or as another organization whose domain is verified on the same mail account.

The shared mailer now sends as a channel's `fromAddress` only when the address's domain is listed in the new `MUNIN_MAIL_ORG_FROM_DOMAINS` setting (comma-separated, exact domain match). When the setting is unset, no domain is listed. A channel on any other domain keeps working: its mail goes out from the address in `MUNIN_MAIL_FROM`, with the channel's `fromName` as the display name and its `fromAddress` as the Reply-To, so replies still reach the organization's mailbox. A `replyToTemplate` or a reply-domain address still takes precedence as the Reply-To, and the Message-ID uses the domain the mail is actually sent from. A single-organization deployment can set `MUNIN_MAIL_ORG_FROM_DOMAINS=*` to allow any address, but that lets every organization pick any From address on the shared sender. Channels that send through their own SMTP server are unaffected.

The rule covers every path that sends through a channel on the shared mailer: conversation replies, outreach sends and broadcasts, `conv_send_email_channel_test`, and the chat widget's email follow-ups. `conv_configure_email_channel` and `POST /v1/conversations/channels/email` now return `effectiveSender` (`from`, `usesDeploymentSender`, and a `note` when the deployment sender is used), so the caller can see what recipients will get. On the shared mailer, a `replyToTemplate` containing `{conversationId}` is now filled in, where it used to be sent as written.

The chat widget's email follow-up, which emails an unread reply to the visitor after about ten minutes, now only goes to an address Munin can trust: one signed through widget identity verification, attested by the organization, or received through an email channel. An address the visitor typed into the widget (`visitor.email`, `PATCH /v1/widget/visitor`) or that sits on an anonymous session no longer gets follow-ups. Previously an anonymous visitor could make the organization's mailbox email any address, quoting the visitor's own messages.
