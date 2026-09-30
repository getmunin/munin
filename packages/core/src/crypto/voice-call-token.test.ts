import { describe, expect, it } from 'vitest';
import {
  VOICE_CALL_TOKEN_MAX_AGE_SECONDS,
  VoiceCallTokenError,
  signVoiceCallToken,
  verifyVoiceCallToken,
} from './voice-call-token.ts';
import { signAttachmentToken } from './attachment-token.ts';

const PEPPER = 'test-pepper-do-not-use-in-prod';

const BASE = {
  orgId: 'org_a',
  channelId: 'cch_voice',
  conversationId: 'ccv_one',
  endUserId: 'eu_one',
};

describe('voice call tokens', () => {
  it('round-trips every bound field', () => {
    const payload = verifyVoiceCallToken(signVoiceCallToken(BASE, PEPPER), PEPPER);
    expect(payload).toMatchObject(BASE);
    expect(payload.issuedAt).toBeGreaterThan(0);
  });

  it('round-trips a call that has no end user yet', () => {
    const token = signVoiceCallToken({ ...BASE, endUserId: null }, PEPPER);
    expect(verifyVoiceCallToken(token, PEPPER).endUserId).toBeNull();
  });

  it('rejects a token whose conversation id was swapped for another conversation', () => {
    const token = signVoiceCallToken(BASE, PEPPER);
    expect(() => verifyVoiceCallToken(token.replace('ccv_one', 'ccv_two'), PEPPER)).toThrow(
      VoiceCallTokenError,
    );
  });

  it('rejects a token whose end user was swapped', () => {
    const token = signVoiceCallToken(BASE, PEPPER);
    expect(() => verifyVoiceCallToken(token.replace('eu_one', 'eu_two'), PEPPER)).toThrow(
      VoiceCallTokenError,
    );
  });

  it('rejects a token signed with a different pepper', () => {
    const token = signVoiceCallToken(BASE, PEPPER);
    expect(() => verifyVoiceCallToken(token, 'other-pepper')).toThrow(VoiceCallTokenError);
  });

  it('rejects a token older than the max age', () => {
    const issuedAt = Math.floor(Date.now() / 1000) - VOICE_CALL_TOKEN_MAX_AGE_SECONDS - 60;
    const token = signVoiceCallToken({ ...BASE, issuedAt }, PEPPER);
    expect(() => verifyVoiceCallToken(token, PEPPER)).toThrow(/expired/);
  });

  it('rejects another token family signed with the same pepper', () => {
    const other = signAttachmentToken({ orgId: 'org_a', attachmentId: 'cva_b' }, PEPPER);
    expect(() => verifyVoiceCallToken(other, PEPPER)).toThrow(VoiceCallTokenError);
  });

  it('refuses to sign without a pepper', () => {
    const prior = process.env.MUNIN_KEY_PEPPER;
    delete process.env.MUNIN_KEY_PEPPER;
    try {
      expect(() => signVoiceCallToken(BASE)).toThrow(/MUNIN_KEY_PEPPER/);
    } finally {
      if (prior !== undefined) process.env.MUNIN_KEY_PEPPER = prior;
    }
  });
});
