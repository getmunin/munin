import { z } from 'zod';
import { sensitive } from './sensitive.ts';

const HOST_RE =
  /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

const HostSchema = z.string().min(1).max(253).regex(HOST_RE);

export const AgentModeSchema = z.enum(['auto', 'draft_only', 'off']);

export type AgentMode = z.infer<typeof AgentModeSchema>;

export const SmtpOutboundSchema = z.object({
  provider: z.literal('smtp'),
  host: HostSchema,
  port: z.number().int().min(1).max(65535),
  secure: z.boolean(),
  username: z.string().min(1),
  password: sensitive(z.string().min(1).optional()),
  trackOpens: z.boolean().optional(),
});

export const MailerOutboundSchema = z.object({
  provider: z.literal('mailer'),
  trackOpens: z.boolean().optional(),
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
  password: sensitive(z.string().min(1).optional()),
  mailbox: z.string().max(120).optional(),
});

export const SendLimitsSchema = z.object({
  perDayMax: z.number().int().positive().max(1_000_000).optional(),
  perHourMax: z.number().int().positive().max(1_000_000).optional(),
});

export type SendLimits = z.infer<typeof SendLimitsSchema>;

export const EmailChannelConfigInput = z.object({
  addressing: z.object({
    fromAddress: z.string().email(),
    fromName: z.string().max(120).optional(),
    replyToTemplate: z.string().max(200).optional(),
  }),
  outbound: OutboundConfigSchema,
  inbound: ImapInboundSchema.optional(),
  sendLimits: SendLimitsSchema.optional(),
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
  defaultAgentMode: AgentModeSchema.optional(),
});

export type SetupEmailBodyT = z.infer<typeof SetupEmailBody>;

export const SendEmailTestBody = z.object({
  to: z.string().email(),
});

export type SendEmailTestBodyT = z.infer<typeof SendEmailTestBody>;

const E164 = /^\+[1-9]\d{4,18}$/;

export const ConfigureTwilioSmsBody = z
  .object({
    channelId: z.string().optional(),
    name: z.string().min(1).max(120).optional(),
    accountSid: z.string().min(2).max(64).optional(),
    authToken: sensitive(z.string().min(1).max(256).optional()),
    fromNumber: z.string().regex(E164, 'must be E.164').max(32).optional(),
    messagingServiceSid: z.string().min(2).max(64).optional(),
  })
  .refine(
    (v) =>
      v.channelId !== undefined ||
      (v.name &&
        v.accountSid &&
        v.authToken &&
        (v.fromNumber || v.messagingServiceSid)),
    {
      message:
        'name, accountSid, authToken, and either fromNumber or messagingServiceSid are required when creating',
    },
  );

export type ConfigureTwilioSmsBodyT = z.infer<typeof ConfigureTwilioSmsBody>;

export const SendTwilioSmsTestBody = z.object({
  to: z.string().regex(E164, 'must be E.164').max(32),
  body: z.string().min(1).max(1600).optional(),
});

export type SendTwilioSmsTestBodyT = z.infer<typeof SendTwilioSmsTestBody>;

export const ConfigureMessageBirdSmsBody = z
  .object({
    channelId: z.string().optional(),
    name: z.string().min(1).max(120).optional(),
    accessKey: sensitive(z.string().min(1).max(256).optional()),
    signingKey: sensitive(z.string().min(1).max(256).optional()),
    originator: z.string().min(1).max(32).optional(),
  })
  .refine(
    (v) =>
      v.channelId !== undefined ||
      (v.name && v.accessKey && v.signingKey && v.originator),
    {
      message:
        'name, accessKey, signingKey, and originator are required when creating',
    },
  );

export type ConfigureMessageBirdSmsBodyT = z.infer<typeof ConfigureMessageBirdSmsBody>;

export const SendMessageBirdSmsTestBody = z.object({
  to: z.string().regex(E164, 'must be E.164').max(32),
  body: z.string().min(1).max(1600).optional(),
});

export type SendMessageBirdSmsTestBodyT = z.infer<typeof SendMessageBirdSmsTestBody>;

export const ConfigureVapiBody = z
  .object({
    channelId: z.string().optional(),
    name: z.string().min(1).max(120).optional(),
    apiKey: sensitive(z.string().min(1).max(256).optional()),
    webhookSecret: sensitive(z.string().min(1).max(256).optional()),
    assistantId: z.string().min(1).max(128).optional(),
    phoneNumberId: z.string().min(1).max(128).optional(),
    publicKey: z.string().min(1).max(256).optional(),
    replaceWebhook: z.boolean().optional(),
  })
  .refine(
    (v) =>
      v.channelId !== undefined ||
      (v.name && v.apiKey && v.webhookSecret && v.assistantId),
    {
      message:
        'name, apiKey, webhookSecret, and assistantId are required when creating',
    },
  );

export type ConfigureVapiBodyT = z.infer<typeof ConfigureVapiBody>;

export const VapiCallInitiateBody = z.object({
  to: z.string().regex(E164, 'must be E.164').max(32),
  customerName: z.string().min(1).max(120).optional(),
});

export type VapiCallInitiateBodyT = z.infer<typeof VapiCallInitiateBody>;

export const ConfigureThrellBody = z
  .object({
    channelId: z.string().optional(),
    name: z.string().min(1).max(120).optional(),
    apiKey: sensitive(z.string().min(1).max(256).optional()),
    accountId: z.string().min(1).max(128).optional(),
    workerId: z.string().min(1).max(128).optional(),
    replaceWebhook: z.boolean().optional(),
  })
  .refine((v) => v.channelId !== undefined || (v.name && v.apiKey && v.workerId), {
    message: 'name, apiKey, and workerId are required when creating',
  });

export type ConfigureThrellBodyT = z.infer<typeof ConfigureThrellBody>;

export const ChannelListOptionsBody = z.object({
  vendor: z.string().min(1).max(40),
  config: sensitive(z.record(z.string(), z.unknown())),
});

export type ChannelListOptionsBodyT = z.infer<typeof ChannelListOptionsBody>;

export const ThrellCallInitiateBody = z.object({
  to: z.string().regex(E164, 'must be E.164').max(32),
  customerName: z.string().min(1).max(120).optional(),
});

export type ThrellCallInitiateBodyT = z.infer<typeof ThrellCallInitiateBody>;

export const ConfigureChannelBody = z.object({
  vendor: z.string().min(1).max(40),
  channelId: z.string().optional(),
  name: z.string().min(1).max(120).optional(),
  config: z.record(z.string(), z.unknown()),
});

export type ConfigureChannelBodyT = z.infer<typeof ConfigureChannelBody>;

export const ChannelVoiceCallBody = z.object({
  to: z.string().regex(E164, 'must be E.164').max(32),
  customerName: z.string().min(1).max(120).optional(),
});

export type ChannelVoiceCallBodyT = z.infer<typeof ChannelVoiceCallBody>;

export const ChannelSendTestBody = z.object({
  to: z.string().min(2).max(64),
  body: z.string().min(1).max(1600).optional(),
});

export type ChannelSendTestBodyT = z.infer<typeof ChannelSendTestBody>;
