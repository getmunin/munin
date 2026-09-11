export type AutoReplySignal =
  | 'auto_submitted'
  | 'precedence_junk'
  | 'precedence_bulk'
  | 'x_autoreply'
  | 'x_autorespond'
  | 'subject';

export interface SenderClassification {
  isMailingList: boolean;
  isAutoReply: boolean;
  isRoleAccount: boolean;
  isBounce: boolean;
  autoReplySignal: AutoReplySignal | null;
}

const ROLE_LOCAL_PARTS = new Set([
  'support',
  'sales',
  'info',
  'noreply',
  'no-reply',
  'donotreply',
  'do-not-reply',
  'hello',
  'contact',
  'billing',
  'admin',
  'office',
  'team',
  'help',
  'mailer-daemon',
  'postmaster',
  'newsletter',
  'notifications',
  'notification',
  'accounts',
  'careers',
  'hr',
  'marketing',
  'press',
  'media',
  'legal',
  'dpo',
  'privacy',
  'security',
  'abuse',
  'webmaster',
  'mail',
  'reply',
  'replies',
  'bounce',
  'bounces',
]);

const AUTO_REPLY_SUBJECT_PREFIXES = [
  'automatisk svar',
  'automatisk fravaer',
  'fravaer',
  'autosvar',
  'automatiskt svar',
  'fravaerende',
  'fravarande',
  'franvarande',
  'ute av kontoret',
  'out of office',
  'out of the office',
  'automatic reply',
  'auto reply',
  'auto-reply',
  'autoreply',
  'automatische antwort',
  'abwesenheitsnotiz',
  'reponse automatique',
];

const SUBJECT_REPLY_PREFIX = /^(?:(?:re|sv|svar|aw|fwd?|vs|vb)\s*:\s*)+/;

const AUTO_SUBMITTED_AUTO_REPLY = new Set(['auto-replied', 'auto-generated', 'auto-notified']);

const BOUNCE_LOCAL_PARTS = new Set([
  'mailer-daemon',
  'mailerdaemon',
  'mail-daemon',
  'postmaster',
  'bounce',
  'bounces',
  'bounced',
  'bounce-handler',
]);

export function classifySender(
  headerLines: ReadonlyArray<{ key: string; line: string }>,
  fromAddress: string,
): SenderClassification {
  const precedence = (headerValue(headerLines, 'precedence') ?? '').toLowerCase();
  const autoSubmitted = (headerValue(headerLines, 'auto-submitted') ?? '').toLowerCase().trim();
  const returnPath = (headerValue(headerLines, 'return-path') ?? '').trim();

  const hasListHeaders =
    hasHeader(headerLines, 'list-id') ||
    hasHeader(headerLines, 'list-unsubscribe') ||
    hasHeader(headerLines, 'list-post');

  const isMailingList = hasListHeaders || /\b(bulk|list)\b/.test(precedence);

  const autoReplySignal = detectAutoReplySignal(
    headerLines,
    autoSubmitted,
    precedence,
    hasListHeaders,
  );
  const isAutoReply = autoReplySignal !== null;

  const local = (fromAddress.split('@')[0] ?? '').toLowerCase();
  const localBase = local.split('+')[0] ?? local;

  const contentType = (headerValue(headerLines, 'content-type') ?? '').toLowerCase();
  const isDeliveryStatusReport =
    /multipart\/report/.test(contentType) &&
    /report-type\s*=\s*"?delivery-status"?/.test(contentType);

  const reportsDeliveryFailure =
    isDeliveryStatusReport ||
    hasHeader(headerLines, 'x-failed-recipients') ||
    BOUNCE_LOCAL_PARTS.has(localBase) ||
    /^<?mailer-daemon@/i.test(returnPath);

  const bounceShapedEnvelopeSender =
    /^<\s*>$/.test(returnPath) || /^<?postmaster@/i.test(returnPath);

  const isBounce = reportsDeliveryFailure || (bounceShapedEnvelopeSender && !isAutoReply);

  const isRoleAccount = ROLE_LOCAL_PARTS.has(localBase) || /^no-?reply|^do-?not-?reply/.test(localBase);

  return { isMailingList, isAutoReply, isRoleAccount, isBounce, autoReplySignal };
}

function detectAutoReplySignal(
  headerLines: ReadonlyArray<{ key: string; line: string }>,
  autoSubmitted: string,
  precedence: string,
  hasListHeaders: boolean,
): AutoReplySignal | null {
  const autoSubmittedToken = autoSubmitted.split(/[;(\s]/)[0] ?? '';
  if (AUTO_SUBMITTED_AUTO_REPLY.has(autoSubmittedToken)) return 'auto_submitted';
  if (/\bjunk\b/.test(precedence)) return 'precedence_junk';
  if (hasHeader(headerLines, 'x-autoreply')) return 'x_autoreply';
  if (hasHeader(headerLines, 'x-autorespond')) return 'x_autorespond';
  if (hasAutoReplySubject(headerValue(headerLines, 'subject'))) return 'subject';
  if (/\bbulk\b/.test(precedence) && !hasListHeaders) return 'precedence_bulk';
  return null;
}

export function hasAutoReplySubject(subject: string | null): boolean {
  if (!subject) return false;
  const normalized = foldDiacritics(subject.trim().toLowerCase()).replace(SUBJECT_REPLY_PREFIX, '');
  return AUTO_REPLY_SUBJECT_PREFIXES.some((prefix) =>
    new RegExp(`^${prefix}\\s*[:\\-\u2013]`).test(normalized),
  );
}

function foldDiacritics(value: string): string {
  return value
    .replace(/æ/g, 'ae')
    .replace(/ø/g, 'oe')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export function hasAnyClassification(c: SenderClassification): boolean {
  return c.isMailingList || c.isAutoReply || c.isRoleAccount || c.isBounce;
}

export type SuppressionReason = 'auto_reply' | 'bounce';

export function suppressionReason(c: SenderClassification): SuppressionReason | null {
  if (c.isBounce) return 'bounce';
  if (c.isAutoReply) return 'auto_reply';
  return null;
}

function headerValue(
  headerLines: ReadonlyArray<{ key: string; line: string }>,
  name: string,
): string | null {
  const lower = name.toLowerCase();
  for (const h of headerLines) {
    if (h.key.toLowerCase() === lower) {
      return h.line.split(':').slice(1).join(':').trim();
    }
  }
  return null;
}

function hasHeader(
  headerLines: ReadonlyArray<{ key: string; line: string }>,
  name: string,
): boolean {
  const lower = name.toLowerCase();
  return headerLines.some((h) => h.key.toLowerCase() === lower);
}
