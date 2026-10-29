import { canSendWithoutReview } from '@getmunin/types';
import type { JourneyValidation } from './journey-types';

export type JourneyNodeRecord = Record<string, unknown> & { id: string; type: string };

export const NEW_STEP_KINDS = ['email', 'sms', 'chat', 'voice', 'wait', 'wait_for', 'action', 'goal', 'approval', 'exit'] as const;
export type NewStepKind = (typeof NEW_STEP_KINDS)[number];

const NODE_ID = /^[a-z][a-z0-9_]{0,47}$/;

const EDGE_FIELDS: Record<string, readonly string[]> = {
  message: ['next', 'onReply', 'onUnseen'],
  action: ['next'],
  wait: ['next'],
  goal: ['next'],
  wait_for: ['next', 'onTimeout'],
  branch: ['default'],
  jump: ['to'],
  agent: ['next'],
  approval: ['next', 'onReject', 'onTimeout'],
  sub_journey: ['next', 'onGoal'],
};

export type DraftEdit =
  | { kind: 'updateNode'; node: JourneyNodeRecord }
  | { kind: 'addNode'; node: JourneyNodeRecord; after?: { nodeId: string; edge: 'next' } }
  | { kind: 'removeNode'; nodeId: string };

export function isNodeId(value: string): boolean {
  return NODE_ID.test(value);
}

export function specNodes(spec: Record<string, unknown> | null | undefined): JourneyNodeRecord[] {
  const nodes = spec?.nodes;
  if (!Array.isArray(nodes)) return [];
  return nodes.filter(
    (n): n is JourneyNodeRecord =>
      !!n && typeof n === 'object' && typeof (n as { id?: unknown }).id === 'string' && typeof (n as { type?: unknown }).type === 'string',
  );
}

export function edgeFieldsFor(node: JourneyNodeRecord): string[] {
  const fields = EDGE_FIELDS[node.type] ?? [];
  if (node.type !== 'message') return [...fields];
  const channel = typeof node.channel === 'string' ? node.channel : 'email';
  return fields.filter((f) => (f === 'onUnseen' ? channel === 'chat' : f === 'onReply' ? channel !== 'voice' : true));
}

export function setField(node: JourneyNodeRecord, field: string, value: unknown): JourneyNodeRecord {
  const next: JourneyNodeRecord = { ...node };
  if (value === undefined || value === null || value === '') delete next[field];
  else next[field] = value;
  return next;
}

export function autoAllowed(node: JourneyNodeRecord): boolean {
  const channel = node.channel === 'sms' || node.channel === 'voice' || node.channel === 'chat' ? node.channel : 'email';
  return canSendWithoutReview(channel, node.class === 'transactional' ? 'transactional' : 'marketing');
}

export function setMessageClass(node: JourneyNodeRecord, messageClass: string): JourneyNodeRecord {
  const next = setField(node, 'class', messageClass === 'transactional' ? 'transactional' : undefined);
  return next.approval === 'auto' && !autoAllowed(next) ? { ...next, approval: 'draft_only' } : next;
}

export function setContent(node: JourneyNodeRecord, field: 'subject' | 'body', value: string): JourneyNodeRecord {
  const content = { ...((node.content as Record<string, unknown> | undefined) ?? {}) };
  if (value === '' && field === 'subject') delete content.subject;
  else content[field] = value;
  return { ...node, content };
}

export function suggestNodeId(kind: NewStepKind, taken: readonly string[]): string {
  const base = kind;
  if (!taken.includes(base)) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base}_${i}`;
    if (!taken.includes(candidate)) return candidate;
  }
}

export function skeletonNode(kind: NewStepKind, id: string): JourneyNodeRecord {
  switch (kind) {
    case 'email':
      return { id, type: 'message', channel: 'email', content: { subject: 'Subject', body: 'Hi {{name}},' }, approval: 'auto' };
    case 'sms':
      return { id, type: 'message', channel: 'sms', content: { body: 'Hi {{name|there}},' } };
    case 'chat':
      return { id, type: 'message', channel: 'chat', content: { body: 'Hi {{name|there}}!' }, approval: 'auto' };
    case 'voice':
      return { id, type: 'message', channel: 'voice', content: { body: 'Hi, this is a quick call about…' } };
    case 'wait':
      return { id, type: 'wait', duration: 'P1D' };
    case 'wait_for':
      return { id, type: 'wait_for', event: 'subscription.started', timeout: 'P7D' };
    case 'action':
      return { id, type: 'action', action: 'crm.add_tag', params: { tag: 'journey' } };
    case 'goal':
      return { id, type: 'goal', name: 'converted' };
    case 'approval':
      return { id, type: 'approval', title: 'Approve before continuing' };
    case 'exit':
      return { id, type: 'exit' };
  }
}

export function insertAfter(
  anchor: JourneyNodeRecord | null,
  node: JourneyNodeRecord,
): { node: JourneyNodeRecord; after?: { nodeId: string; edge: 'next' } } {
  if (!anchor || !edgeFieldsFor(anchor).includes('next')) return { node };
  const following = typeof anchor.next === 'string' ? anchor.next : undefined;
  const carries = following && edgeFieldsFor(node).includes('next');
  return { node: carries ? { ...node, next: following } : node, after: { nodeId: anchor.id, edge: 'next' } };
}

export function parseNodeJson(text: string, expectedId: string): { node: JourneyNodeRecord } | { error: 'json' | 'shape' | 'id' } {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { error: 'json' };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { error: 'shape' };
  const record = value as Record<string, unknown>;
  if (typeof record.type !== 'string' || typeof record.id !== 'string') return { error: 'shape' };
  if (record.id !== expectedId) return { error: 'id' };
  return { node: record as JourneyNodeRecord };
}

export function nodesWithErrors(validation: JourneyValidation | null | undefined): Set<string> {
  return new Set((validation?.errors ?? []).map((e) => e.nodeId).filter((id): id is string => typeof id === 'string'));
}
