export type EventTone = 'conv' | 'kb' | 'crm' | 'out';

export interface EventLike {
  type: string;
  actorLabel: string | null;
  payload: Record<string, unknown>;
}

const PREFIX_TONE: Array<[string, EventTone]> = [
  ['conversation.', 'conv'],
  ['kb.', 'kb'],
  ['crm.', 'crm'],
  ['outreach.', 'out'],
];

export function eventTone(type: string): EventTone {
  for (const [prefix, tone] of PREFIX_TONE) {
    if (type.startsWith(prefix)) return tone;
  }
  return 'conv';
}

export function eventLabelKey(type: string): string {
  return `dashboard.activity.types.${type}`;
}

type Tr = (key: string, values?: Record<string, string | number>) => string;

export function eventDetail(event: EventLike, t: Tr): string {
  const p = event.payload;
  const parts: string[] = [];

  const subject = pickString(p, ['subject', 'title', 'name', 'slug']);
  if (subject) parts.push(subject);

  const who = pickString(p, ['email', 'companyName', 'contactName', 'recipient']);
  if (who) parts.push(who);

  const stage = pickString(p, ['stage', 'status']);
  if (stage) parts.push(stage);

  if (parts.length === 0 && event.actorLabel) parts.push(event.actorLabel);

  if (parts.length === 0) {
    const cid = pickString(p, ['conversationId']);
    if (cid) parts.push(`conv=${cid.slice(0, 12)}…`);
  }

  const detail = parts.join(' · ');
  if (detail) return detail;

  try {
    return t(`${eventLabelKey(event.type)}.detail`);
  } catch {
    return '';
  }
}

function pickString(o: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return null;
}

