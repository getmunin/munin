export interface PluralValue {
  zero?: string;
  one: string;
  two?: string;
  few?: string;
  many?: string;
  other: string;
}

export type StringValue = string | PluralValue;

export interface Strings {
  launcherAriaLabel: string;
  closeAriaLabel: string;
  backAriaLabel: string;
  messageAriaLabel: string;
  sendAriaLabel: string;
  agentTypingAriaLabel: string;
  newConversation: string;
  conversation: string;
  onlineNow: string;
  defaultTeammateName: string;
  typicallyReplies: string;
  statusReconnecting: string;
  statusDisconnected: string;
  saveThreadEyebrow: string;
  saveThreadBlurb: string;
  saveThreadCta: string;
  saveThreadSkip: string;
  saveThreadDoneEyebrow: string;
  saveThreadDoneTemplate: string;
  emailPlaceholder: string;
  composerPlaceholder: string;
  defaultEyebrow: string;
  defaultGreeting: string;
  defaultTitle: string;
  welcomeRepliesAboutHtml: string;
  startConversationLabel: string;
  startConversationSub: string;
  conversationsHeader: string;
  emptyConversationsTitle: string;
  emptyConversationsSub: string;
  poweredBy: string;
  defaultAuthorName: string;
  roleAi: string;
  roleHuman: string;
  timeNow: string;
  timeMin: string;
  timeHour: string;
  timeDay: string;
  timeWeek: string;
  timeMonth: string;
}

const PLURAL_KEYS: readonly (keyof PluralValue)[] = ['zero', 'one', 'two', 'few', 'many', 'other'];

export function format(
  value: StringValue,
  locale: string,
  params: Record<string, string | number> = {},
): string {
  let template: string;
  if (typeof value === 'string') {
    template = value;
  } else {
    const count = typeof params.count === 'number' ? params.count : 0;
    const rules = new Intl.PluralRules(locale);
    const category = rules.select(count);
    template = value[category] ?? value.other;
  }
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    params[key] !== undefined ? String(params[key]) : '',
  );
}

export function isPluralValue(v: StringValue): v is PluralValue {
  if (typeof v === 'string') return false;
  return PLURAL_KEYS.some((k) => k in v);
}
