import { randomUUID } from 'node:crypto';
import { describeError, safeFetch } from '@getmunin/core';
import { stripTrailingSlashes } from '@getmunin/types';
import {
  parseAttachments,
  type CuratorJob,
  type MuninRestClient,
  type SkillPassResult,
} from '@getmunin/agent-runtime';
import { authHeaders } from './provider-auth.ts';

const TRANSCRIPTION_TIMEOUT_MS = 120_000;

export type TranscriptionRestClient = Pick<MuninRestClient, 'getConversation' | 'recordTranscription'>;

export interface TranscribeVoiceNoteOpts {
  job: CuratorJob;
  rest: TranscriptionRestClient;
  providerBaseUrl: string;
  providerApiKey: string;
  transcriptionModel: string | null;
  fetchAudio?: (url: string) => Promise<{ body: Buffer; mime: string }>;
  transcribe?: (input: TranscriptionRequest) => Promise<string>;
  logger: { info: (m: string) => void; warn: (m: string) => void };
}

export interface TranscriptionRequest {
  baseUrl: string;
  apiKey: string;
  model: string;
  audio: Buffer;
  mime: string;
  filename: string;
}

export async function runTranscribeVoiceNoteJob(opts: TranscribeVoiceNoteOpts): Promise<SkillPassResult> {
  const ids = readIds(opts.job.sourceEventPayload);
  if (!ids) {
    return { ok: false, skipped: 'agent_error', error: 'transcription job is missing conversationId/messageId' };
  }
  const { conversationId, messageId } = ids;
  const finish = async (status: 'done' | 'failed', extra: { text?: string; error?: string }) => {
    await opts.rest.recordTranscription(conversationId, messageId, {
      status,
      ...extra,
      ...(opts.transcriptionModel ? { model: opts.transcriptionModel } : {}),
    });
    return done(status === 'done' ? `transcribed ${messageId}` : `transcription failed for ${messageId}`);
  };

  if (!opts.transcriptionModel) {
    return finish('failed', { error: 'no transcription model is selected in AI settings' });
  }

  const detail = await opts.rest.getConversation(conversationId);
  const message = detail.messages.find((m) => m.id === messageId);
  if (!message) return finish('failed', { error: 'voice note message not found' });
  const audio = parseAttachments(message.attachments).find(
    (a) => a.url !== null && a.mime.toLowerCase().startsWith('audio/'),
  );
  if (!audio?.url) return finish('failed', { error: 'voice note has no stored audio' });

  let text: string;
  try {
    const bytes = await (opts.fetchAudio ?? fetchAudio)(audio.url);
    text = await (opts.transcribe ?? transcribeWithProvider)({
      baseUrl: opts.providerBaseUrl,
      apiKey: opts.providerApiKey,
      model: opts.transcriptionModel,
      audio: bytes.body,
      mime: bytes.mime || audio.mime,
      filename: audio.name ?? `voice-note.${extensionFor(audio.mime)}`,
    });
  } catch (err) {
    const error = describeError(err);
    if (opts.job.attempts < opts.job.maxAttempts) {
      opts.logger.warn(`transcription attempt ${opts.job.attempts} for ${messageId} failed: ${error}`);
      return { ok: false, skipped: 'provider_error', error };
    }
    return finish('failed', { error });
  }
  opts.logger.info(`transcribed voice note ${messageId} (${text.length} chars)`);
  return finish('done', { text });
}

async function fetchAudio(url: string): Promise<{ body: Buffer; mime: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`audio download returned HTTP ${res.status}`);
  return {
    body: Buffer.from(await res.arrayBuffer()),
    mime: res.headers.get('content-type') ?? '',
  };
}

export async function transcribeWithProvider(input: TranscriptionRequest): Promise<string> {
  const boundary = `----munin${randomUUID().replace(/-/g, '')}`;
  const body = Buffer.concat([
    field(boundary, 'model', input.model),
    field(boundary, 'response_format', 'json'),
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${sanitizeFilename(input.filename)}"\r\nContent-Type: ${input.mime.split(';')[0]!.trim()}\r\n\r\n`,
    ),
    input.audio,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const res = await safeFetch(`${stripTrailingSlashes(input.baseUrl)}/audio/transcriptions`, {
    method: 'POST',
    headers: {
      ...authHeaders(input.baseUrl, input.apiKey),
      'content-type': `multipart/form-data; boundary=${boundary}`,
    },
    body,
    signal: AbortSignal.timeout(TRANSCRIPTION_TIMEOUT_MS),
  });
  const payload = (await res.json().catch(() => null)) as { text?: unknown; error?: unknown } | null;
  if (!res.ok) {
    const detail =
      payload && typeof payload.error === 'object' && payload.error !== null
        ? (payload.error as { message?: unknown }).message
        : undefined;
    const message = typeof detail === 'string' ? detail : '';
    throw new Error(`transcription provider returned HTTP ${res.status}${message ? `: ${message}` : ''}`);
  }
  if (!payload || typeof payload.text !== 'string') {
    throw new Error('transcription provider returned no text');
  }
  return payload.text;
}

function field(boundary: string, name: string, value: string): Buffer {
  return Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`);
}

function sanitizeFilename(name: string): string {
  return name.replace(/["\r\n\\]/g, '_');
}

function extensionFor(mime: string): string {
  const base = mime.split(';')[0]!.trim().toLowerCase();
  if (base === 'audio/mpeg') return 'mp3';
  if (base === 'audio/mp4') return 'm4a';
  if (base === 'audio/aac') return 'aac';
  if (base === 'audio/webm') return 'webm';
  return 'ogg';
}

function readIds(payload: unknown): { conversationId: string; messageId: string } | null {
  if (!payload || typeof payload !== 'object') return null;
  const { conversationId, messageId } = payload as { conversationId?: unknown; messageId?: unknown };
  if (typeof conversationId !== 'string' || typeof messageId !== 'string') return null;
  return { conversationId, messageId };
}

function done(replyText: string): SkillPassResult {
  return { ok: true, toolCalls: 0, totalTokens: 0, finishReason: 'stop', replyText };
}
