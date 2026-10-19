import type { ActorIdentity } from '@getmunin/core';
import { CONVERSATION_EVENT_TYPES } from '@getmunin/types';
import type { EventRow } from './db-listener.service.ts';

export type RealtimeAccess = 'staff' | 'member' | 'end_user' | 'widget';

export interface CustomerEventRow {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  created_at: string;
}

const ADMIN_ROLES: ReadonlySet<string> = new Set(['owner', 'admin']);

export const MEMBER_EVENT_TYPES: ReadonlySet<string> = new Set(CONVERSATION_EVENT_TYPES);

export const CUSTOMER_EVENT_FIELDS: Readonly<Record<string, readonly string[]>> = {
  'conversation.created': ['conversationId'],
  'conversation.status_changed': ['conversationId', 'status'],
  'conversation.subject_changed': ['conversationId'],
  'conversation.assigned': ['conversationId'],
  'conversation.taken_over': ['conversationId'],
  'conversation.released': ['conversationId'],
  'conversation.handover_requested': ['conversationId'],
  'conversation.handover_resolved': ['conversationId'],
  'conversation.message.received': ['conversationId', 'messageId', 'authorType'],
  'conversation.message.sent': ['conversationId', 'messageId', 'authorType'],
  'conversation.message.body_revised': ['conversationId', 'messageId', 'authorType'],
  'conversation.message.read': ['conversationId', 'messageId', 'readAt'],
  'conversation.voice.call_ended': ['conversationId'],
};

export function realtimeAccessFor(
  actor: ActorIdentity,
  orgRole: string | null,
): RealtimeAccess | null {
  switch (actor.type) {
    case 'system':
      return 'staff';
    case 'user':
      if (!orgRole) return null;
      return ADMIN_ROLES.has(orgRole) ? 'staff' : 'member';
    case 'admin_agent':
      return actor.hasAudience('admin') && actor.hasScope('*') ? 'staff' : null;
    case 'end_user_agent':
      return actor.endUserId ? 'end_user' : null;
    default:
      return null;
  }
}

export function memberMaySubscribe(key: string): boolean {
  return key === 'org' || key.startsWith('conversation:');
}

export function mayRelayOperatorTyping(access: RealtimeAccess): boolean {
  return access === 'staff' || access === 'member';
}

export function projectEventForCustomer(event: EventRow): CustomerEventRow | null {
  const fields = Object.hasOwn(CUSTOMER_EVENT_FIELDS, event.type)
    ? CUSTOMER_EVENT_FIELDS[event.type]
    : undefined;
  if (!fields) return null;
  const source = event.payload ?? {};
  if (source['internal'] === true) return null;
  if (typeof source['conversationId'] !== 'string') return null;
  const payload: Record<string, unknown> = {};
  for (const field of fields) {
    if (source[field] !== undefined) payload[field] = source[field];
  }
  return { id: event.id, type: event.type, payload, created_at: event.created_at };
}

export function eventForAccess(
  access: RealtimeAccess,
  event: EventRow,
): EventRow | CustomerEventRow | null {
  if (access === 'staff') return event;
  if (access === 'member') return MEMBER_EVENT_TYPES.has(event.type) ? event : null;
  return projectEventForCustomer(event);
}
