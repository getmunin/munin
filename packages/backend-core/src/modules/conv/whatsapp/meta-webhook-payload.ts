export type MetaInboundKind =
  | 'text'
  | 'image'
  | 'audio'
  | 'video'
  | 'document'
  | 'sticker'
  | 'location'
  | 'contacts'
  | 'interactive'
  | 'button'
  | 'unsupported';

export interface MetaInboundMessage {
  wamid: string;
  from: string;
  name: string | null;
  receivedAt: Date;
  kind: MetaInboundKind;
  body: string;
  media: { id: string; mime: string; name: string } | null;
  contextWamid: string | null;
  metadata: Record<string, unknown>;
  raw: Record<string, unknown>;
}

export interface MetaStatusUpdate {
  wamid: string;
  status: 'sent' | 'delivered' | 'read' | 'failed' | 'unknown';
  at: Date;
  errors: Array<{ code: number | null; title: string | null; message: string | null }>;
}

export interface MetaReaction {
  wamid: string;
  targetWamid: string;
  emoji: string | null;
  from: string;
  at: Date;
}

export interface ParsedMetaWebhook {
  messages: MetaInboundMessage[];
  statuses: MetaStatusUpdate[];
  reactions: MetaReaction[];
}

export const WHATSAPP_VOICE_NOTE_PLACEHOLDER = '[Voice message]';

export const OPT_OUT_BUTTON_PAYLOADS = new Set(['stop promotions', 'stop', 'unsubscribe']);

export function parseMetaWebhook(body: unknown, phoneNumberId: string): ParsedMetaWebhook {
  const out: ParsedMetaWebhook = { messages: [], statuses: [], reactions: [] };
  const root = asRecord(body);
  for (const entry of asArray(root.entry)) {
    for (const change of asArray(asRecord(entry).changes)) {
      const c = asRecord(change);
      if (c.field !== 'messages') continue;
      const value = asRecord(c.value);
      const metadata = asRecord(value.metadata);
      if (str(metadata.phone_number_id) !== phoneNumberId) continue;

      const names = new Map<string, string>();
      for (const contact of asArray(value.contacts)) {
        const record = asRecord(contact);
        const waId = str(record.wa_id);
        const name = str(asRecord(record.profile).name);
        if (waId && name) names.set(waId, name);
      }

      for (const message of asArray(value.messages)) {
        const m = asRecord(message);
        if (str(m.type) === 'reaction') {
          const reaction = parseReaction(m);
          if (reaction) out.reactions.push(reaction);
          continue;
        }
        const parsed = parseMessage(m, names);
        if (parsed) out.messages.push(parsed);
      }

      for (const status of asArray(value.statuses)) {
        const parsed = parseStatus(asRecord(status));
        if (parsed) out.statuses.push(parsed);
      }
    }
  }
  return out;
}

export function toE164(waId: string): string {
  const digits = waId.replace(/[^\d]/g, '');
  return `+${digits}`;
}

function parseMessage(m: Record<string, unknown>, names: Map<string, string>): MetaInboundMessage | null {
  const wamid = str(m.id);
  const from = str(m.from);
  if (!wamid || !from) return null;
  const type = str(m.type) ?? 'unsupported';
  const contextWamid = str(asRecord(m.context).id);
  const base = {
    wamid,
    from: toE164(from),
    name: names.get(from) ?? null,
    receivedAt: fromUnixSeconds(m.timestamp),
    contextWamid,
    raw: m,
  };

  switch (type) {
    case 'text':
      return { ...base, kind: 'text', body: str(asRecord(m.text).body) ?? '', media: null, metadata: {} };
    case 'image': {
      const image = asRecord(m.image);
      return {
        ...base,
        kind: 'image',
        body: str(image.caption) ?? '',
        media: mediaRef(image, 'image', wamid),
        metadata: {},
      };
    }
    case 'audio': {
      const audio = asRecord(m.audio);
      return {
        ...base,
        kind: 'audio',
        body: WHATSAPP_VOICE_NOTE_PLACEHOLDER,
        media: mediaRef(audio, 'voice-note', wamid),
        metadata: { voiceNote: true },
      };
    }
    case 'video': {
      const video = asRecord(m.video);
      return {
        ...base,
        kind: 'video',
        body: joinNonEmpty(['[Video]', str(video.caption)]),
        media: null,
        metadata: {},
      };
    }
    case 'document': {
      const document = asRecord(m.document);
      const filename = str(document.filename);
      return {
        ...base,
        kind: 'document',
        body: joinNonEmpty([filename ? `[Document: ${filename}]` : '[Document]', str(document.caption)]),
        media: null,
        metadata: {},
      };
    }
    case 'sticker':
      return { ...base, kind: 'sticker', body: '[Sticker]', media: null, metadata: {} };
    case 'location': {
      const location = asRecord(m.location);
      const label = joinNonEmpty([str(location.name), str(location.address)], ', ');
      const coords =
        typeof location.latitude === 'number' && typeof location.longitude === 'number'
          ? `${location.latitude},${location.longitude}`
          : null;
      return {
        ...base,
        kind: 'location',
        body: `[Location${label ? `: ${label}` : ''}${coords ? ` (${coords})` : ''}]`,
        media: null,
        metadata: {},
      };
    }
    case 'contacts': {
      const shared = asArray(m.contacts)
        .map((c) => str(asRecord(asRecord(c).name).formatted_name))
        .filter((n): n is string => !!n);
      return {
        ...base,
        kind: 'contacts',
        body: `[Contact card${shared.length > 0 ? `: ${shared.join(', ')}` : ''}]`,
        media: null,
        metadata: {},
      };
    }
    case 'interactive': {
      const interactive = asRecord(m.interactive);
      const reply = asRecord(interactive.button_reply ?? interactive.list_reply);
      const title = str(reply.title) ?? '';
      const description = str(reply.description);
      return {
        ...base,
        kind: 'interactive',
        body: joinNonEmpty([title, description], ' — '),
        media: null,
        metadata: { interactiveReply: { id: str(reply.id), title } },
      };
    }
    case 'button': {
      const button = asRecord(m.button);
      const text = str(button.text) ?? '';
      const payload = str(button.payload);
      return {
        ...base,
        kind: 'button',
        body: text,
        media: null,
        metadata: {
          buttonReply: { text, payload },
          ...(isOptOutButton(text, payload) ? { optOutButton: true } : {}),
        },
      };
    }
    default:
      return { ...base, kind: 'unsupported', body: '[Unsupported message]', media: null, metadata: {} };
  }
}

function parseReaction(m: Record<string, unknown>): MetaReaction | null {
  const wamid = str(m.id);
  const from = str(m.from);
  const reaction = asRecord(m.reaction);
  const targetWamid = str(reaction.message_id);
  if (!wamid || !from || !targetWamid) return null;
  return {
    wamid,
    targetWamid,
    emoji: str(reaction.emoji),
    from: toE164(from),
    at: fromUnixSeconds(m.timestamp),
  };
}

function parseStatus(s: Record<string, unknown>): MetaStatusUpdate | null {
  const wamid = str(s.id);
  if (!wamid) return null;
  const raw = str(s.status);
  const status =
    raw === 'sent' || raw === 'delivered' || raw === 'read' || raw === 'failed' ? raw : 'unknown';
  return {
    wamid,
    status,
    at: fromUnixSeconds(s.timestamp),
    errors: asArray(s.errors).map((e) => {
      const r = asRecord(e);
      return {
        code: typeof r.code === 'number' ? r.code : null,
        title: str(r.title),
        message: str(r.message) ?? str(asRecord(r.error_data).details),
      };
    }),
  };
}

function isOptOutButton(text: string, payload: string | null): boolean {
  return (
    OPT_OUT_BUTTON_PAYLOADS.has(text.trim().toLowerCase()) ||
    (payload !== null && OPT_OUT_BUTTON_PAYLOADS.has(payload.trim().toLowerCase()))
  );
}

function mediaRef(
  media: Record<string, unknown>,
  prefix: string,
  wamid: string,
): { id: string; mime: string; name: string } | null {
  const id = str(media.id);
  if (!id) return null;
  const mime = str(media.mime_type) ?? 'application/octet-stream';
  return { id, mime, name: `${prefix}-${shortId(wamid)}.${extensionFor(mime)}` };
}

function extensionFor(mime: string): string {
  const base = mime.split(';')[0]!.trim().toLowerCase();
  switch (base) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    case 'image/gif':
      return 'gif';
    case 'audio/ogg':
      return 'ogg';
    case 'audio/mpeg':
      return 'mp3';
    case 'audio/mp4':
      return 'm4a';
    case 'audio/aac':
      return 'aac';
    case 'audio/amr':
      return 'amr';
    default:
      return 'bin';
  }
}

function shortId(wamid: string): string {
  return wamid.replace(/[^A-Za-z0-9]/g, '').slice(-12) || 'media';
}

function fromUnixSeconds(value: unknown): Date {
  const n = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : NaN;
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000) : new Date();
}

function joinNonEmpty(parts: Array<string | null | undefined>, separator = '\n'): string {
  return parts.filter((p): p is string => !!p && p.trim().length > 0).join(separator);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}
