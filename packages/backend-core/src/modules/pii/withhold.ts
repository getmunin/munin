export const WITHHELD_TEXT = '[WITHHELD: not yet checked for names]';

export const MESSAGE_ID = /^cvm_[0-9a-z]{22}$/;
export const CONVERSATION_ID = /^ccv_[0-9a-z]{22}$/;

const STRUCTURAL_KEY = /^(?:id|.+Id|.+Ids|.+At)$/;

const KEPT_MESSAGE_KEYS: ReadonlySet<string> = new Set([
  'authorName',
  'authorType',
  'deliveryAttempts',
  'deliveryStatus',
  'height',
  'inline',
  'internal',
  'kind',
  'mime',
  'openCount',
  'rank',
  'score',
  'sizeBytes',
  'status',
  'type',
  'uploaded',
  'width',
]);

const CONVERSATION_TEXT_KEYS: readonly string[] = ['subject', 'lastInboundPreview'];

export interface UncheckedSubjects {
  messages: ReadonlySet<string>;
  conversations: ReadonlySet<string>;
}

export interface WithheldResult {
  value: unknown;
  withheld: number;
}

export function collectSubjectIds(value: unknown): { messages: string[]; conversations: string[] } {
  const messages = new Set<string>();
  const conversations = new Set<string>();
  const visit = (node: unknown): void => {
    if (typeof node === 'string') {
      if (MESSAGE_ID.test(node)) messages.add(node);
      else if (CONVERSATION_ID.test(node)) conversations.add(node);
    } else if (Array.isArray(node)) {
      for (const item of node) visit(item);
    } else if (node && typeof node === 'object') {
      for (const item of Object.values(node)) visit(item);
    }
  };
  visit(value);
  return { messages: [...messages], conversations: [...conversations] };
}

export function withholdUncheckedText(value: unknown, unchecked: UncheckedSubjects): WithheldResult {
  let withheld = 0;
  const visit = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(visit);
    if (!node || typeof node !== 'object') return node;
    const record = node as Record<string, unknown>;
    const ownsUncheckedText = [record.id, record.messageId].some(
      (id) => typeof id === 'string' && unchecked.messages.has(id),
    );
    if (ownsUncheckedText) {
      withheld += 1;
      return redactMessage(record);
    }
    const out: Record<string, unknown> = {};
    const unfinishedConversation =
      typeof record.id === 'string' && unchecked.conversations.has(record.id);
    for (const [key, child] of Object.entries(record)) {
      out[key] =
        unfinishedConversation && CONVERSATION_TEXT_KEYS.includes(key) && typeof child === 'string'
          ? WITHHELD_TEXT
          : visit(child);
    }
    return out;
  };
  return { value: visit(value), withheld };
}

function redactMessage(node: unknown, key?: string): unknown {
  if (key && (STRUCTURAL_KEY.test(key) || KEPT_MESSAGE_KEYS.has(key))) return node;
  if (typeof node === 'string') return node.length === 0 ? node : WITHHELD_TEXT;
  if (Array.isArray(node)) return node.map((item) => redactMessage(item));
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {};
    for (const [childKey, child] of Object.entries(node)) out[childKey] = redactMessage(child, childKey);
    return out;
  }
  return node;
}
