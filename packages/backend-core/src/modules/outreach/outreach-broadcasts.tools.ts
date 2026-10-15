import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { McpTool } from '@getmunin/mcp-toolkit';
import { EMAIL_CONTENT_FORMATS } from './email-template-render.ts';
import {
  BROADCAST_RECIPIENT_STATUSES,
  BROADCAST_STATUSES,
  OutreachBroadcastsService,
} from './outreach-broadcasts.service.ts';
import { translateInvalid } from './outreach.tools.ts';
import { INSPECTOR_APP_URI } from '../../mcp/inspector.resource.ts';

const Id = z.string().min(1).max(64);
const SendAt = z
  .string()
  .datetime({ offset: true })
  .nullable()
  .describe('ISO 8601 time the broadcast should start sending, e.g. "2026-10-20T08:00:00+02:00". Null or a past time means as soon as it is approved.');

const Content = z.object({
  format: z
    .enum(EMAIL_CONTENT_FORMATS)
    .describe(
      '`markdown` renders as one text section styled by the template; `mjml` is a fragment of <mj-section>/<mj-wrapper> elements for cards, images and buttons.',
    ),
  body: z
    .string()
    .min(1)
    .max(100_000)
    .describe('The message. May use {{name}} / {{name|there}}, {{org_name}} and {{subject}}.'),
});

const CreateBroadcastInput = z.object({
  name: z.string().min(1).max(120).describe('Internal name, unique per org, e.g. "Changelog — October 2026".'),
  segmentId: Id.describe('CRM segment whose eligible contacts receive the broadcast.'),
  channelId: Id.describe('Active email channel the broadcast is sent from.'),
  emailTemplateId: Id.nullable()
    .optional()
    .describe('Email template to render the content in. Leave out to use the org default template, or the built-in layout when the org has none.'),
  subject: z.string().min(1).max(300),
  preheader: z
    .string()
    .max(300)
    .nullable()
    .optional()
    .describe('Inbox preview line shown after the subject.'),
  content: Content,
  scheduledSendAt: SendAt.optional(),
  maxPerHour: z
    .number()
    .int()
    .min(1)
    .max(100_000)
    .nullable()
    .optional()
    .describe('Upper bound on sends per hour for this broadcast, on top of the deployment-wide per-channel limit.'),
});

const UpdateBroadcastInput = CreateBroadcastInput.partial().extend({ id: Id });

const GetBroadcastInput = z.object({ id: Id });
const ListBroadcastsInput = z.object({
  status: z.enum(BROADCAST_STATUSES).optional(),
  limit: z.number().int().min(1).max(200).optional(),
});
const ListRecipientsInput = z.object({
  id: Id.describe('Broadcast id.'),
  status: z.enum(BROADCAST_RECIPIENT_STATUSES).optional(),
  limit: z.number().int().min(1).max(500).optional(),
  after: Id.optional().describe('`nextCursor` from the previous page.'),
});
const ApproveBroadcastInput = z.object({
  id: Id,
  fingerprint: z
    .string()
    .min(1)
    .max(64)
    .describe('`contentFingerprint` of the broadcast as it was read and reviewed.'),
  sendAt: SendAt.optional().describe(
    'Overrides the broadcast’s scheduledSendAt. Null or a past time sends as soon as approved.',
  ),
});
const DismissBroadcastInput = z.object({ id: Id, reason: z.string().max(500).optional() });
const CancelBroadcastInput = z.object({ id: Id, reason: z.string().min(1).max(500) });
const SendTestInput = z.object({
  id: Id,
  to: z
    .string()
    .email()
    .max(320)
    .optional()
    .describe('Address of a member of this organization. Defaults to the signed-in caller.'),
});

@Injectable()
export class OutreachBroadcastTools {
  constructor(
    @Inject(OutreachBroadcastsService) private readonly broadcasts: OutreachBroadcastsService,
  ) {}

  @McpTool({
    name: 'outreach_create_broadcast',
    title: 'Outreach: Create broadcast',
    description:
      'Draft one email to send to every eligible contact in a CRM segment, such as a changelog or newsletter. Nothing is sent: the broadcast is created `pending` and waits in the review queue until a signed-in person approves it. The content is rendered through an email template (the one named, else the org default, else a built-in layout) and validated now, so content that would not render is refused here. Every recipient gets a personal unsubscribe link and one-click unsubscribe headers. Returns the broadcast with a live `audience` preview (eligible count and how many contacts are excluded, and why), a rendered `preview` for a sample recipient, and the `contentFingerprint` the approval is bound to.',
    audiences: ['admin'],
    scopes: ['outreach:write'],
    input: CreateBroadcastInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  createBroadcast(args: z.infer<typeof CreateBroadcastInput>) {
    return translateInvalid(() => this.broadcasts.createBroadcast(args));
  }

  @McpTool({
    name: 'outreach_update_broadcast',
    title: 'Outreach: Update broadcast',
    description:
      'Change a pending broadcast: name, segment, channel, template, subject, preheader, content, send time or hourly limit. Content is re-validated. Any change produces a new `contentFingerprint`, so an approval given for the earlier version is refused. Broadcasts that are approved, sending or finished cannot be edited.',
    audiences: ['admin'],
    scopes: ['outreach:write'],
    input: UpdateBroadcastInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  updateBroadcast(args: z.infer<typeof UpdateBroadcastInput>) {
    return translateInvalid(() => this.broadcasts.updateBroadcast(args));
  }

  @McpTool({
    name: 'outreach_get_broadcast',
    title: 'Outreach: Read broadcast',
    description:
      'Read one broadcast. While it is pending, `audience` is computed live from the segment (eligible count, exclusions by reason, a few sample recipients), `preview` is the email rendered for a sample recipient exactly as it would be sent, and `contentFingerprint` binds an approval to that rendering and audience size. Once approved, the audience is frozen and `counts` track progress: queued, sent, skipped, failed, replied, unsubscribed and bounced.',
    audiences: ['admin'],
    scopes: ['outreach:read'],
    input: GetBroadcastInput,
    readOnlyHint: true,
    destructiveHint: false,
    _meta: { ui: { resourceUri: INSPECTOR_APP_URI }, 'ui/resourceUri': INSPECTOR_APP_URI },
  })
  getBroadcast(args: z.infer<typeof GetBroadcastInput>) {
    return translateInvalid(() => this.broadcasts.getBroadcast(args.id));
  }

  @McpTool({
    name: 'outreach_list_broadcasts',
    title: 'Outreach: List broadcasts',
    description:
      'List broadcasts, newest first, optionally filtered by status (`pending`, `approved`, `sending`, `sent`, `cancelled`, `dismissed`, `failed`). Each row carries its delivery `counts`. Content and previews are left out.',
    audiences: ['admin'],
    scopes: ['outreach:read'],
    input: ListBroadcastsInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  listBroadcasts(args: z.infer<typeof ListBroadcastsInput>) {
    return this.broadcasts.listBroadcasts(args);
  }

  @McpTool({
    name: 'outreach_list_broadcast_recipients',
    title: 'Outreach: List broadcast recipients',
    description:
      'List the frozen recipients of an approved broadcast with each one’s delivery status, skip or failure reason, and when they replied or unsubscribed. A recipient is skipped at send time when they unsubscribed, were marked do-not-contact, lost their lawful basis or became undeliverable after approval. Paginate with `after`.',
    audiences: ['admin'],
    scopes: ['outreach:read'],
    input: ListRecipientsInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  listRecipients(args: z.infer<typeof ListRecipientsInput>) {
    return translateInvalid(() =>
      this.broadcasts.listRecipients({
        broadcastId: args.id,
        status: args.status,
        limit: args.limit,
        after: args.after,
      }),
    );
  }

  @McpTool({
    name: 'outreach_send_broadcast_test',
    title: 'Outreach: Send broadcast test',
    description:
      'Send one copy of a broadcast, subject prefixed with "[Test]", to a member of this organization so it can be checked in a real inbox before approval. Goes to the signed-in caller unless `to` names another member; any other address is refused. Uses the broadcast’s channel and template; the unsubscribe link in a test unsubscribes nobody.',
    audiences: ['admin'],
    scopes: ['outreach:write'],
    input: SendTestInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  sendTest(args: z.infer<typeof SendTestInput>) {
    return translateInvalid(() => this.broadcasts.sendBroadcastTest(args));
  }

  @McpTool({
    name: 'outreach_approve_broadcast',
    title: 'Outreach: Approve broadcast',
    description:
      'Approve a pending broadcast so it is sent to its segment. Only a signed-in person can approve; agents and API keys are refused. The approval is bound to `fingerprint`: if the content, template or audience size changed since it was read, the call is refused with a conflict and nothing is sent. Approving freezes the audience (contacts added to the segment later are not included) and the rendered email; a background worker then sends at a throttled rate from `sendAt` (or now), re-checking unsubscribes, do-not-contact, lawful basis and deliverability for each recipient just before sending.',
    audiences: ['admin'],
    scopes: ['outreach:write'],
    input: ApproveBroadcastInput,
    readOnlyHint: false,
    destructiveHint: true,
    _meta: { ui: { visibility: ['app'] } },
  })
  approveBroadcast(args: z.infer<typeof ApproveBroadcastInput>) {
    return translateInvalid(() => this.broadcasts.approveBroadcast(args));
  }

  @McpTool({
    name: 'outreach_dismiss_broadcast',
    title: 'Outreach: Dismiss broadcast',
    description:
      'Reject a pending broadcast so it is never sent. The reason is kept for the review history.',
    audiences: ['admin'],
    scopes: ['outreach:write'],
    input: DismissBroadcastInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  dismissBroadcast(args: z.infer<typeof DismissBroadcastInput>) {
    return translateInvalid(() => this.broadcasts.dismissBroadcast(args));
  }

  @McpTool({
    name: 'outreach_cancel_broadcast',
    title: 'Outreach: Cancel broadcast',
    description:
      'Call off an approved or sending broadcast; `reason` is kept on it. One that has not started sending yet goes back to `pending` in the review queue with nothing sent: its frozen recipient list is dropped, and it can be edited and must be approved again before anything goes out. One that is already sending stops: recipients not yet sent to are marked skipped, emails already delivered cannot be recalled, and `counts.sent` reports how many went out.',
    audiences: ['admin'],
    scopes: ['outreach:write'],
    input: CancelBroadcastInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  cancelBroadcast(args: z.infer<typeof CancelBroadcastInput>) {
    return translateInvalid(() => this.broadcasts.cancelBroadcast(args));
  }
}
