import { describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { jsonbToStored, tryJsonbToStored } from './email.service.ts';

const COMPLETE: Record<string, unknown> = {
  addressing: { fromAddress: 'hei@example.test', fromName: 'Support' },
  outbound: {
    provider: 'smtp',
    host: 'smtp.example.test',
    port: 587,
    secure: false,
    username: 'postmaster',
    encryptedPassword: 'ciphertext',
  },
};

const MISSING_OUTBOUND: Record<string, unknown> = {
  addressing: { fromAddress: 'hei@example.test' },
};

describe('jsonbToStored', () => {
  it('returns the parsed config when the stored shape is complete', () => {
    expect(jsonbToStored(COMPLETE).outbound.provider).toBe('smtp');
  });

  it('throws a coded BadRequest naming the missing field rather than a raw ZodError', () => {
    let thrown: unknown;
    try {
      jsonbToStored(MISSING_OUTBOUND);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(BadRequestException);
    const body = (thrown as BadRequestException).getResponse() as {
      message: string;
      code: string;
      fields: string[];
    };
    expect(body.code).toBe('conv_channel_config_invalid');
    expect(body.fields).toEqual(['outbound']);
    expect(body.message).toContain('conv_channel_config_invalid:');
  });
});

describe('tryJsonbToStored', () => {
  it('returns null instead of throwing so a full save can rebuild the config', () => {
    expect(tryJsonbToStored(MISSING_OUTBOUND)).toBeNull();
    expect(tryJsonbToStored(COMPLETE)).not.toBeNull();
  });
});
