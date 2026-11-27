import { describe, expect, it } from 'vitest';
import {
  COMPANY_PROFILE_SLUG,
  VOICE_SYSTEM_PROMPT_SLUG,
  type KbDocLocation,
  type KbDocReader,
  type PromptCache,
} from '@getmunin/core';
import {
  composeVoiceSystemPrompt,
  formatLanguageContext,
  formatVoiceChannelContext,
  loadVoiceChannelContext,
} from './vapi-assistant.ts';

describe('formatLanguageContext', () => {
  it('names the widget locale so the voice agent greets in it', () => {
    const out = formatLanguageContext('sv');
    expect(out).toContain('[Language]');
    expect(out).toContain('Swedish (sv)');
  });

  it('accepts region-tagged locales', () => {
    expect(formatLanguageContext('nb-NO')).toContain('Norwegian Bokmål');
  });

  it('returns nothing for missing, blank, malformed or unknown locales', () => {
    expect(formatLanguageContext(undefined)).toBeUndefined();
    expect(formatLanguageContext(42)).toBeUndefined();
    expect(formatLanguageContext('  ')).toBeUndefined();
    expect(formatLanguageContext('not a locale!')).toBeUndefined();
    expect(formatLanguageContext('xx')).toBeUndefined();
  });
});

function promptsOf(bodies: Record<string, string>): PromptCache {
  return {
    get: (slug) => bodies[slug] ?? '',
    has: (slug) => slug in bodies,
    refresh: async () => {},
    refreshAll: async () => {},
  };
}

describe('composeVoiceSystemPrompt', () => {
  it('appends each extra context block after the company context, skipping empty ones', () => {
    const out = composeVoiceSystemPrompt(
      promptsOf({ [VOICE_SYSTEM_PROMPT_SLUG]: 'Speak briefly.', [COMPANY_PROFILE_SLUG]: 'Acme' }),
      'conv_1',
      '[Channel]\nphone line',
      undefined,
      '',
      '[Caller]\n+4712345678',
    );
    expect(out.split('\n\n')).toEqual([
      'Speak briefly. When a tool asks for a conversationId, pass exactly: conv_1 — never substitute placeholders.',
      '[Company context]\nAcme',
      '[Channel]\nphone line',
      '[Caller]\n+4712345678',
    ]);
  });
});

describe('formatVoiceChannelContext', () => {
  it('names the channel and appends its descriptor', () => {
    expect(formatVoiceChannelContext({ id: 'cch_1', name: 'Acme line' }, '  Answer for Acme.  ')).toBe(
      '[Channel]\nThis conversation arrived on the channel "Acme line" (channelId: cch_1).\n\nAnswer for Acme.',
    );
  });

  it('falls back to the id alone when the channel has no name and no descriptor', () => {
    expect(formatVoiceChannelContext({ id: 'cch_1', name: '  ' }, '')).toBe(
      '[Channel]\nThis conversation arrived on channelId: cch_1.',
    );
  });
});

describe('loadVoiceChannelContext', () => {
  it('reads the per-channel descriptor from the agent-runtime space by the channel slug', async () => {
    const seen: KbDocLocation[] = [];
    const reader: KbDocReader = {
      getBody: (location) => {
        seen.push(location);
        return Promise.resolve('Answer for Globex.');
      },
    };
    const out = await loadVoiceChannelContext(reader, { id: 'cch_AB_12', name: 'Globex line' });
    expect(seen).toEqual([{ spaceSlug: 'agent-runtime', slug: 'channel-cch-ab-12' }]);
    expect(out).toContain('Answer for Globex.');
  });

  it('still names the channel when the descriptor cannot be read', async () => {
    const reader: KbDocReader = {
      getBody: () => Promise.reject(new Error('db down')),
    };
    expect(await loadVoiceChannelContext(reader, { id: 'cch_1', name: 'Acme line' })).toBe(
      '[Channel]\nThis conversation arrived on the channel "Acme line" (channelId: cch_1).',
    );
  });
});
