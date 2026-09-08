import type { MessageDto } from './inbox-types';

export type MessageRole = 'self' | 'other' | 'agent' | 'system';

export const PARTICIPANT_HUES = [165, 32, 210, 75, 315] as const;

const PARTICIPANT_RING_MIN_HUMANS = 3;

export function participantColor(hue: number): string {
  return `oklch(var(--munin-participant-l) 0.105 ${hue})`;
}

export function messageRole(message: MessageDto, viewerUserId: string | null): MessageRole {
  if (message.authorType === 'system') return 'system';
  if (message.authorType === 'agent') return 'agent';
  if (message.authorType !== 'user') return 'other';
  return viewerUserId === null || message.authorId === viewerUserId ? 'self' : 'other';
}

export function participantKey(message: MessageDto): string {
  return `${message.authorType}:${message.authorId}`;
}

export function participantHues(
  messages: readonly MessageDto[],
  viewerUserId: string | null,
): Map<string, number> {
  if (viewerUserId === null) return new Map();
  const humans: string[] = [`user:${viewerUserId}`];
  const others: string[] = [];
  for (const message of messages) {
    const role = messageRole(message, viewerUserId);
    if (role === 'system' || role === 'agent') continue;
    const key = participantKey(message);
    if (!humans.includes(key)) humans.push(key);
    if (role === 'other' && !others.includes(key)) others.push(key);
  }
  if (humans.length < PARTICIPANT_RING_MIN_HUMANS) return new Map();
  return new Map(
    others.map((key, i) => [key, PARTICIPANT_HUES[i % PARTICIPANT_HUES.length]!] as const),
  );
}
