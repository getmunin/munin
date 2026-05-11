import { z } from 'zod';

const HOST_RE =
  /^(localhost|(?:\d{1,3}\.){3}\d{1,3}|[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+)$/;

const HostSchema = z.string().min(1).max(253).regex(HOST_RE);

export const SmtpOutboundSchema = z.object({
  provider: z.literal('smtp'),
  host: HostSchema,
  port: z.number().int().min(1).max(65535),
  secure: z.boolean(),
  username: z.string().min(1),
  password: z.string().min(1).optional(),
});

export const MailerOutboundSchema = z.object({
  provider: z.literal('mailer'),
});

export const OutboundConfigSchema = z.discriminatedUnion('provider', [
  SmtpOutboundSchema,
  MailerOutboundSchema,
]);

export const ImapInboundSchema = z.object({
  provider: z.literal('imap'),
  host: HostSchema,
  port: z.number().int().min(1).max(65535),
  secure: z.boolean(),
  username: z.string().min(1),
  password: z.string().min(1).optional(),
  mailbox: z.string().max(120).optional(),
});

export const EmailChannelConfigInput = z.object({
  addressing: z.object({
    fromAddress: z.string().email(),
    fromName: z.string().max(120).optional(),
    replyToTemplate: z.string().max(200).optional(),
  }),
  outbound: OutboundConfigSchema,
  inbound: ImapInboundSchema.optional(),
});

export type EmailChannelConfigInputT = z.infer<typeof EmailChannelConfigInput>;

export const CreateWidgetBody = z.object({
  name: z.string().min(1).max(120),
  originAllowlist: z.array(z.string().url()).default([]),
  webhookOnEscalation: z.string().url().optional(),
  requireVerifiedIdentity: z.boolean().optional(),
});

export type CreateWidgetBodyT = z.infer<typeof CreateWidgetBody>;

export const UpdateWidgetBody = z.object({
  originAllowlist: z.array(z.string().url()).optional(),
  webhookOnEscalation: z.string().url().nullable().optional(),
  requireVerifiedIdentity: z.boolean().optional(),
});

export type UpdateWidgetBodyT = z.infer<typeof UpdateWidgetBody>;

export const SetupEmailBody = z.object({
  channelId: z.string().optional(),
  name: z.string().min(1).max(120),
  config: EmailChannelConfigInput,
});

export type SetupEmailBodyT = z.infer<typeof SetupEmailBody>;
