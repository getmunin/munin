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

export function classifySender(
  headerLines: ReadonlyArray<{ key: string; line: string }>,
  fromAddress: string,
): SenderClassification {
  const precedence = (headerValue(headerLines, 'precedence') ?? '').toLowerCase();
  const autoSubmitted = (headerValue(headerLines, 'auto-submitted') ?? '').toLowerCase().trim();
  const returnPath = (headerValue(headerLines, 'return-path') ?? '').trim();

  const isMailingList =
    hasHeader(headerLines, 'list-id') ||
    hasHeader(headerLines, 'list-unsubscribe') ||
    hasHeader(headerLines, 'list-post') ||
    /\b(bulk|list)\b/.test(precedence);

  const isAutoReply =
    (autoSubmitted !== '' && autoSubmitted !== 'no') ||
    /\bjunk\b/.test(precedence) ||
    hasHeader(headerLines, 'x-auto-response-suppress') ||
    hasHeader(headerLines, 'x-autoreply') ||
    hasHeader(headerLines, 'x-autorespond');

  const isBounce =
    /^<\s*>$/.test(returnPath) ||
    /^<?mailer-daemon@/i.test(returnPath) ||
    /^<?postmaster@/i.test(returnPath) ||
    /^mailer-daemon@/i.test(fromAddress) ||
    /^postmaster@/i.test(fromAddress);

  const local = (fromAddress.split('@')[0] ?? '').toLowerCase();
  const localBase = local.split('+')[0] ?? local;
  const isRoleAccount = ROLE_LOCAL_PARTS.has(localBase) || /^no-?reply|^do-?not-?reply/.test(localBase);

  return { isMailingList, isAutoReply, isRoleAccount, isBounce };
}

export function hasAnyClassification(c: SenderClassification): boolean {
  return c.isMailingList || c.isAutoReply || c.isRoleAccount || c.isBounce;
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
