export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export interface SendRules {
  timezone: string;
  quietHours: string | null;
  validDays: Weekday[] | null;
  weeklyCap: number | null;
  cooldownHoursAfterConversation: number;
}

export interface SendRulesDto extends SendRules {
  configured: boolean;
  recommended: Omit<SendRules, 'timezone'>;
}

export interface SendRulesForm {
  timezone: string;
  quietEnabled: boolean;
  quietFrom: string;
  quietTo: string;
  daysEnabled: boolean;
  days: Weekday[];
  capEnabled: boolean;
  cap: string;
  cooldownHours: string;
}

export type SendRulesFormError = 'quietSame' | 'noDays' | 'capRange' | 'cooldownRange';

const FALLBACK_QUIET = '20:00-08:00';

function splitWindow(window: string): [string, string] {
  const [from, to] = window.split('-');
  return [from ?? '20:00', to ?? '08:00'];
}

export function formFromRules(rules: SendRules, recommended: Omit<SendRules, 'timezone'>): SendRulesForm {
  const [quietFrom, quietTo] = splitWindow(rules.quietHours ?? recommended.quietHours ?? FALLBACK_QUIET);
  return {
    timezone: rules.timezone,
    quietEnabled: rules.quietHours !== null,
    quietFrom,
    quietTo,
    daysEnabled: rules.validDays !== null,
    days: rules.validDays ?? [...WEEKDAYS],
    capEnabled: rules.weeklyCap !== null,
    cap: String(rules.weeklyCap ?? recommended.weeklyCap ?? 3),
    cooldownHours: String(rules.cooldownHoursAfterConversation),
  };
}

export function recommendedForm(dto: SendRulesDto, timezone: string): SendRulesForm {
  return formFromRules({ ...dto.recommended, timezone }, dto.recommended);
}

export function rulesFromForm(form: SendRulesForm): { rules: SendRules } | { error: SendRulesFormError } {
  if (form.quietEnabled && form.quietFrom === form.quietTo) return { error: 'quietSame' };
  if (form.daysEnabled && form.days.length === 0) return { error: 'noDays' };
  const cap = Number(form.cap);
  if (form.capEnabled && (!Number.isInteger(cap) || cap < 1 || cap > 50)) return { error: 'capRange' };
  const cooldown = Number(form.cooldownHours);
  if (form.cooldownHours.trim() === '' || !Number.isInteger(cooldown) || cooldown < 0 || cooldown > 720) {
    return { error: 'cooldownRange' };
  }
  return {
    rules: {
      timezone: form.timezone,
      quietHours: form.quietEnabled ? `${form.quietFrom}-${form.quietTo}` : null,
      validDays: form.daysEnabled ? WEEKDAYS.filter((d) => form.days.includes(d)) : null,
      weeklyCap: form.capEnabled ? cap : null,
      cooldownHoursAfterConversation: cooldown,
    },
  };
}

export function sameRules(a: SendRules, b: SendRules): boolean {
  return (
    a.timezone === b.timezone &&
    a.quietHours === b.quietHours &&
    a.weeklyCap === b.weeklyCap &&
    a.cooldownHoursAfterConversation === b.cooldownHoursAfterConversation &&
    (a.validDays ?? []).join(',') === (b.validDays ?? []).join(',') &&
    (a.validDays === null) === (b.validDays === null)
  );
}

export function timeZoneOptions(current: string): string[] {
  const supported =
    typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  const zones = new Set<string>(['UTC', ...supported]);
  zones.add(current);
  return [...zones].sort((a, b) => (a === 'UTC' ? -1 : b === 'UTC' ? 1 : a.localeCompare(b)));
}
