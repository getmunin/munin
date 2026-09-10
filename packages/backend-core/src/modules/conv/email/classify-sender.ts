export interface SenderClassification {
  isMailingList: boolean;
  isAutoReply: boolean;
  isRoleAccount: boolean;
  isBounce: boolean;
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

  const isAutoReply =
    (autoSubmitted !== '' && autoSubmitted !== 'no') ||
    /\bjunk\b/.test(precedence) ||
    hasHeader(headerLines, 'x-auto-response-suppress') ||
    hasHeader(headerLines, 'x-autoreply') ||
    hasHeader(headerLines, 'x-autorespond') ||
    hasAutoReplySubject(headerValue(headerLines, 'subject')) ||
    (/\bbulk\b/.test(precedence) && !hasListHeaders);

  const local = (fromAddress.split('@')[0] ?? '').toLowerCase();
  const localBase = local.split('+')[0] ?? local;

  const contentType = (headerValue(headerLines, 'content-type') ?? '').toLowerCase();
  const isDeliveryStatusReport =
    /multipart\/report/.test(contentType) &&
    /report-type\s*=\s*"?delivery-status"?/.test(contentType);

  const isBounce =
    /^<\s*>$/.test(returnPath) ||
    /^<?mailer-daemon@/i.test(returnPath) ||
    /^<?postmaster@/i.test(returnPath) ||
    BOUNCE_LOCAL_PARTS.has(localBase) ||
    isDeliveryStatusReport ||
    hasHeader(headerLines, 'x-failed-recipients');

  const isRoleAccount = ROLE_LOCAL_PARTS.has(localBase) || /^no-?reply|^do-?not-?reply/.test(localBase);

  return { isMailingList, isAutoReply, isRoleAccount, isBounce };
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
