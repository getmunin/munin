export const MUNIN_VERSION = '0.0.1';

export {
  SmtpOutboundSchema,
  MailerOutboundSchema,
  OutboundConfigSchema,
  ImapInboundSchema,
  SendLimitsSchema,
  type SendLimits,
  EmailChannelConfigInput,
  type EmailChannelConfigInputT,
  CreateWidgetBody,
  type CreateWidgetBodyT,
  UpdateWidgetBody,
  type UpdateWidgetBodyT,
  SetupEmailBody,
  type SetupEmailBodyT,
  SendEmailTestBody,
  type SendEmailTestBodyT,
} from './channels.js';
export {
  KNOWN_SKILL_URIS,
  KNOWN_TASK_URIS,
  WEB_SCRAPE_SITE_TASK_URI,
  jobKindOf,
  tierFor,
  toolPrefixesFor,
  type JobKind,
  type ModelTier,
} from './job-catalog.js';
