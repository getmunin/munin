export type AuthorKind = 'user' | 'agent' | 'end_user' | 'system';

export interface ConversationSnapshot {
  displayId: number;
  subject: string | null;
  channelType: string;
  channelName: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  dashboardUrl: string;
}

export interface MessageAttachment {
  name: string | null;
  url: string | null;
}

export interface MessageSnapshot {
  authorKind: AuthorKind;
  authorName: string | null;
  internal: boolean;
  body: string;
  noSpeech?: boolean;
  attachments?: MessageAttachment[];
}

export interface ParentState {
  status: string;
  needsHumanAttention: boolean;
  claimedBy: string | null;
  assignedTo: string | null;
}

export function parseMessageAttachments(raw: unknown[]): MessageAttachment[] {
  return raw.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) return [];
    const record = entry as Record<string, unknown>;
    const url = typeof record.url === 'string' ? record.url : null;
    const name =
      typeof record.name === 'string'
        ? record.name
        : typeof record.filename === 'string'
          ? record.filename
          : null;
    return url || name ? [{ name, url }] : [];
  });
}
