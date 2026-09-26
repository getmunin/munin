import { Inject, Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { decryptSecretSql, readApiBaseUrl, setEncryptionKeySql } from '@getmunin/core';
import type { Db, Tx } from '@getmunin/db';
import { DB } from '../../../common/db/db.module.ts';

export const META_GRAPH_BASE = 'https://graph.facebook.com';
export const DEFAULT_GRAPH_API_VERSION = 'v23.0';
export const META_VERIFY_TOKEN_PURPOSE = 'whatsapp-webhook-verify';

export interface MetaAuth {
  accessToken: string;
  graphApiVersion: string;
}

export interface MetaSendResult {
  wamid: string;
  waId: string | null;
}

export interface MetaTemplateComponent {
  type: string;
  format?: string;
  text?: string;
  buttons?: Array<{ type: string; text?: string }>;
}

export interface MetaTemplate {
  id: string;
  name: string;
  language: string;
  status: string;
  category: string;
  parameterFormat: 'positional' | 'named';
  components: MetaTemplateComponent[];
}

export interface MetaPhoneNumber {
  id: string;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  qualityRating: string | null;
}

export interface MetaTemplateSendParameters {
  header?: Array<{ name?: string; text: string }>;
  body?: Array<{ name?: string; text: string }>;
}

export class MetaGraphError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: number | null,
  ) {
    super(message);
  }
}

@Injectable()
export class MetaGraphClientService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async decryptString(tx: Db | Tx, ciphertext: string): Promise<string> {
    await tx.execute(setEncryptionKeySql());
    const rows = await tx.execute<{ pt: string } & Record<string, unknown>>(
      sql`SELECT ${decryptSecretSql(ciphertext)} AS pt`,
    );
    const pt = rows[0]?.pt;
    if (pt === undefined || pt === null) throw new Error('whatsapp_meta_decrypt_failed');
    return pt;
  }

  async loadSecret(ciphertext: string): Promise<string> {
    return this.db.transaction((tx) => this.decryptString(tx, ciphertext));
  }

  async getPhoneNumber(auth: MetaAuth, phoneNumberId: string): Promise<MetaPhoneNumber> {
    const json = await this.request(
      auth,
      'GET',
      `/${encodeURIComponent(phoneNumberId)}?fields=display_phone_number,verified_name,quality_rating`,
    );
    return {
      id: readString(json.id) ?? phoneNumberId,
      displayPhoneNumber: readString(json.display_phone_number),
      verifiedName: readString(json.verified_name),
      qualityRating: readString(json.quality_rating),
    };
  }

  async subscribeApp(auth: MetaAuth, wabaId: string): Promise<void> {
    await this.request(auth, 'POST', `/${encodeURIComponent(wabaId)}/subscribed_apps`, {});
  }

  async setPhoneNumberWebhook(
    auth: MetaAuth,
    phoneNumberId: string,
    callbackUrl: string,
    verifyToken: string,
  ): Promise<void> {
    await this.request(auth, 'POST', `/${encodeURIComponent(phoneNumberId)}`, {
      webhook_configuration: {
        override_callback_uri: callbackUrl,
        verify_token: verifyToken,
      },
    });
  }

  async sendText(
    auth: MetaAuth,
    phoneNumberId: string,
    to: string,
    body: string,
  ): Promise<MetaSendResult> {
    return this.sendMessage(auth, phoneNumberId, {
      to: toWaRecipient(to),
      type: 'text',
      text: { body, preview_url: true },
    });
  }

  async sendImage(
    auth: MetaAuth,
    phoneNumberId: string,
    to: string,
    link: string,
    caption?: string,
  ): Promise<MetaSendResult> {
    return this.sendMessage(auth, phoneNumberId, {
      to: toWaRecipient(to),
      type: 'image',
      image: { link, ...(caption ? { caption } : {}) },
    });
  }

  async sendTemplate(
    auth: MetaAuth,
    phoneNumberId: string,
    to: string,
    template: { name: string; language: string; parameters: MetaTemplateSendParameters },
  ): Promise<MetaSendResult> {
    const components: Array<Record<string, unknown>> = [];
    for (const type of ['header', 'body'] as const) {
      const params = template.parameters[type];
      if (!params?.length) continue;
      components.push({
        type,
        parameters: params.map((p) => ({
          type: 'text',
          text: p.text,
          ...(p.name ? { parameter_name: p.name } : {}),
        })),
      });
    }
    return this.sendMessage(auth, phoneNumberId, {
      to: toWaRecipient(to),
      type: 'template',
      template: {
        name: template.name,
        language: { code: template.language },
        ...(components.length > 0 ? { components } : {}),
      },
    });
  }

  async listTemplates(auth: MetaAuth, wabaId: string): Promise<MetaTemplate[]> {
    const out: MetaTemplate[] = [];
    let path: string | null =
      `/${encodeURIComponent(wabaId)}/message_templates?fields=id,name,language,status,category,components,parameter_format&limit=100`;
    for (let page = 0; path && page < 20; page += 1) {
      const json = await this.request(auth, 'GET', path);
      const data = Array.isArray(json.data) ? json.data : [];
      for (const item of data) {
        const parsed = parseTemplate(item);
        if (parsed) out.push(parsed);
      }
      path = nextPagePath(json, auth.graphApiVersion);
    }
    return out;
  }

  async downloadMedia(
    auth: MetaAuth,
    mediaId: string,
  ): Promise<{ body: Buffer; mime: string }> {
    const meta = await this.request(auth, 'GET', `/${encodeURIComponent(mediaId)}`);
    const url = readString(meta.url);
    if (!url) throw new Error('whatsapp_meta_media_url_missing');
    const res = await fetch(url, { headers: { authorization: `Bearer ${auth.accessToken}` } });
    if (!res.ok) throw new Error(`whatsapp_meta_media_download_${res.status}`);
    const body = Buffer.from(await res.arrayBuffer());
    const mime = readString(meta.mime_type) ?? res.headers.get('content-type') ?? 'application/octet-stream';
    return { body, mime };
  }

  private async sendMessage(
    auth: MetaAuth,
    phoneNumberId: string,
    payload: Record<string, unknown>,
  ): Promise<MetaSendResult> {
    const json = await this.request(auth, 'POST', `/${encodeURIComponent(phoneNumberId)}/messages`, {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      ...payload,
    });
    const messages = Array.isArray(json.messages) ? json.messages : [];
    const wamid = readString((messages[0] as Record<string, unknown> | undefined)?.id);
    if (!wamid) throw new Error('whatsapp_meta_send_missing_message_id');
    const contacts = Array.isArray(json.contacts) ? json.contacts : [];
    const waId = readString((contacts[0] as Record<string, unknown> | undefined)?.wa_id);
    return { wamid, waId };
  }

  private async request(
    auth: MetaAuth,
    method: 'GET' | 'POST',
    path: string,
    body?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const url = `${META_GRAPH_BASE}/${auth.graphApiVersion}${path}`;
    const res = await fetch(url, {
      method,
      headers: {
        authorization: `Bearer ${auth.accessToken}`,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const error = (json.error ?? {}) as Record<string, unknown>;
      const code = typeof error.code === 'number' ? error.code : null;
      const message = readString(error.message) ?? `HTTP ${res.status}`;
      throw new MetaGraphError(
        `whatsapp_meta_${code ?? res.status}: ${message}`,
        res.status,
        code,
      );
    }
    return json;
  }
}

export function verifyMetaSignature(input: {
  appSecret: string;
  rawBody: Buffer;
  signatureHeader: string;
}): boolean {
  const match = /^sha256=([0-9a-f]{64})$/i.exec(input.signatureHeader.trim());
  if (!match) return false;
  const expected = createHmac('sha256', input.appSecret).update(input.rawBody).digest();
  const provided = Buffer.from(match[1]!, 'hex');
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

export function deriveVerifyToken(channelId: string, pepper = process.env.MUNIN_KEY_PEPPER ?? ''): string {
  if (!pepper) throw new Error('MUNIN_KEY_PEPPER is required to derive the WhatsApp webhook verify token');
  return createHmac('sha256', pepper).update(`${META_VERIFY_TOKEN_PURPOSE}:${channelId}`).digest('hex');
}

export function buildWhatsAppWebhookUrl(channelId: string): string {
  return `${readApiBaseUrl()}/v1/conversations/channels/${channelId}/webhook`;
}

export function toWaRecipient(phone: string): string {
  return phone.replace(/[^\d]/g, '');
}

export function extractTemplatePlaceholders(text: string | undefined): string[] {
  if (!text) return [];
  const seen: string[] = [];
  for (const match of text.matchAll(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g)) {
    const name = match[1]!;
    if (!seen.includes(name)) seen.push(name);
  }
  return seen;
}

function parseTemplate(raw: unknown): MetaTemplate | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Record<string, unknown>;
  const name = readString(item.name);
  const language = readString(item.language);
  if (!name || !language) return null;
  const components = Array.isArray(item.components)
    ? item.components
        .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
        .map((c) => ({
          type: (readString(c.type) ?? '').toLowerCase(),
          ...(readString(c.format) ? { format: readString(c.format)!.toLowerCase() } : {}),
          ...(readString(c.text) ? { text: readString(c.text)! } : {}),
          ...(Array.isArray(c.buttons)
            ? {
                buttons: c.buttons
                  .filter((b): b is Record<string, unknown> => !!b && typeof b === 'object')
                  .map((b) => ({
                    type: (readString(b.type) ?? '').toLowerCase(),
                    ...(readString(b.text) ? { text: readString(b.text)! } : {}),
                  })),
              }
            : {}),
        }))
    : [];
  return {
    id: readString(item.id) ?? `${name}:${language}`,
    name,
    language,
    status: (readString(item.status) ?? 'unknown').toLowerCase(),
    category: (readString(item.category) ?? 'unknown').toLowerCase(),
    parameterFormat: readString(item.parameter_format)?.toLowerCase() === 'named' ? 'named' : 'positional',
    components,
  };
}

function nextPagePath(json: Record<string, unknown>, version: string): string | null {
  const paging = json.paging as { next?: unknown } | undefined;
  const next = readString(paging?.next);
  if (!next) return null;
  const prefix = `${META_GRAPH_BASE}/${version}`;
  return next.startsWith(prefix) ? next.slice(prefix.length) : null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}
