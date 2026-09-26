import { describe, expect, it, vi } from 'vitest';
import type { ConversationDetail, CuratorJob } from '@getmunin/agent-runtime';
import {
  runTranscribeVoiceNoteJob,
  type TranscriptionRequest,
  type TranscriptionRestClient,
} from './transcribe-voice-note.handler.ts';
import { resolveTranscriptionModel } from './runner.service.ts';

function job(overrides: Partial<CuratorJob> = {}): CuratorJob {
  return {
    id: 'cj_1',
    orgId: 'org_1',
    jobUri: 'task://conv/transcribe-voice-note',
    userPrompt: 'Transcribe',
    sourceEventType: 'conversation.message.received',
    sourceEventPayload: { conversationId: 'ccv_1', messageId: 'msg_voice' },
    dedupeKey: null,
    status: 'pending',
    priority: 200,
    attempts: 1,
    maxAttempts: 3,
    nextAttemptAt: new Date().toISOString(),
    leaseExpiresAt: null,
    leaseHolder: null,
    lastError: null,
    lastReplyText: null,
    lastToolCalls: null,
    lastTotalTokens: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    doneAt: null,
    assistantName: null,
    ...overrides,
  };
}

function rest(
  attachments: unknown[] = [
    { id: 'cva_1', mime: 'audio/ogg', name: 'voice-note.ogg', url: 'http://api.test/v1/c/a/token' },
  ],
) {
  const detail: ConversationDetail = {
    id: 'ccv_1',
    status: 'open',
    endUserId: 'eu_1',
    assigneeUserId: null,
    claim: null,
    messages: [
      {
        id: 'msg_voice',
        authorType: 'end_user',
        body: '[Voice message]',
        createdAt: new Date().toISOString(),
        attachments,
      },
    ],
  };
  const recordTranscription = vi.fn<TranscriptionRestClient['recordTranscription']>(() => Promise.resolve());
  const client: TranscriptionRestClient = {
    getConversation: () => Promise.resolve(detail),
    recordTranscription,
  };
  return { client, recordTranscription };
}

const logger = { info: vi.fn(), warn: vi.fn() };

describe('runTranscribeVoiceNoteJob', () => {
  it('transcribes the stored audio with the selected model and records the text', async () => {
    const { client, recordTranscription } = rest();
    const transcribe = vi.fn((input: TranscriptionRequest) => {
      expect(input).toMatchObject({ model: 'whisper-large-v3', mime: 'audio/ogg', filename: 'voice-note.ogg' });
      return Promise.resolve('Hvor er pakken min?');
    });
    const result = await runTranscribeVoiceNoteJob({
      job: job(),
      rest: client,
      providerBaseUrl: 'https://provider.example/v1',
      providerApiKey: 'sk-test',
      transcriptionModel: 'whisper-large-v3',
      fetchAudio: () => Promise.resolve({ body: Buffer.from('ogg'), mime: 'audio/ogg' }),
      transcribe,
      logger,
    });
    expect(result.ok).toBe(true);
    expect(recordTranscription).toHaveBeenCalledWith('ccv_1', 'msg_voice', {
      status: 'done',
      text: 'Hvor er pakken min?',
      model: 'whisper-large-v3',
    });
  });

  it('records a failure without calling the provider when no model is selected', async () => {
    const { client, recordTranscription } = rest();
    const transcribe = vi.fn();
    const result = await runTranscribeVoiceNoteJob({
      job: job(),
      rest: client,
      providerBaseUrl: 'https://provider.example/v1',
      providerApiKey: 'sk-test',
      transcriptionModel: null,
      transcribe,
      logger,
    });
    expect(result.ok).toBe(true);
    expect(transcribe).not.toHaveBeenCalled();
    const [conversationId, messageId, input] = recordTranscription.mock.calls[0]!;
    expect([conversationId, messageId, input.status]).toEqual(['ccv_1', 'msg_voice', 'failed']);
    expect(input.error).toMatch(/no transcription model/);
  });

  it('retries a provider error while attempts remain, then records the failure', async () => {
    const failing = () => Promise.reject(new Error('HTTP 503'));
    const audio = () => Promise.resolve({ body: Buffer.from('ogg'), mime: 'audio/ogg' });

    const first = rest();
    const retry = await runTranscribeVoiceNoteJob({
      job: job({ attempts: 1, maxAttempts: 3 }),
      rest: first.client,
      providerBaseUrl: 'https://provider.example/v1',
      providerApiKey: 'sk-test',
      transcriptionModel: 'whisper-1',
      fetchAudio: audio,
      transcribe: failing,
      logger,
    });
    expect(retry).toMatchObject({ ok: false, skipped: 'provider_error' });
    expect(first.recordTranscription).not.toHaveBeenCalled();

    const last = rest();
    const final = await runTranscribeVoiceNoteJob({
      job: job({ attempts: 3, maxAttempts: 3 }),
      rest: last.client,
      providerBaseUrl: 'https://provider.example/v1',
      providerApiKey: 'sk-test',
      transcriptionModel: 'whisper-1',
      fetchAudio: audio,
      transcribe: failing,
      logger,
    });
    expect(final.ok).toBe(true);
    const [, , input] = last.recordTranscription.mock.calls[0]!;
    expect(input).toMatchObject({ status: 'failed', model: 'whisper-1' });
    expect(input.error).toContain('HTTP 503');
  });

  it('fails cleanly when the voice note has no stored audio', async () => {
    const { client, recordTranscription } = rest([]);
    await runTranscribeVoiceNoteJob({
      job: job(),
      rest: client,
      providerBaseUrl: 'https://provider.example/v1',
      providerApiKey: 'sk-test',
      transcriptionModel: 'whisper-1',
      logger,
    });
    expect(recordTranscription).toHaveBeenCalledWith('ccv_1', 'msg_voice', {
      status: 'failed',
      error: 'voice note has no stored audio',
      model: 'whisper-1',
    });
  });
});

describe('resolveTranscriptionModel', () => {
  it('uses the org’s choice on its own provider', () => {
    expect(resolveTranscriptionModel({ managed: false }, { transcriptionModel: 'whisper-1' }, [])).toBe('whisper-1');
    expect(resolveTranscriptionModel({ managed: false }, { transcriptionModel: null }, [])).toBeNull();
  });

  it('defaults a managed org to the first built-in model and honours a valid choice', () => {
    const builtIn = ['whisper-large-v3', 'voxtral-small'];
    expect(resolveTranscriptionModel({ managed: true }, { transcriptionModel: null }, builtIn)).toBe('whisper-large-v3');
    expect(resolveTranscriptionModel({ managed: true }, { transcriptionModel: 'voxtral-small' }, builtIn)).toBe('voxtral-small');
    expect(resolveTranscriptionModel({ managed: true }, { transcriptionModel: 'gone' }, builtIn)).toBe('whisper-large-v3');
  });

  it('prefers the models the resolved auth offers', () => {
    expect(
      resolveTranscriptionModel({ managed: true, transcriptionModels: ['stt-2'] }, { transcriptionModel: null }, ['stt-1']),
    ).toBe('stt-2');
  });
});
