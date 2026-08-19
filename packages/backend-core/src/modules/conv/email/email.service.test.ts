import { describe, expect, it } from 'vitest';
import { HttpException } from '@nestjs/common';
import { ChannelConfigInvalidError } from '../channels/stored-config.ts';
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

  it('throws a transport-free domain error naming the missing field', () => {
    let thrown: unknown;
    try {
      jsonbToStored(MISSING_OUTBOUND);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(ChannelConfigInvalidError);
    const err = thrown as ChannelConfigInvalidError;
    expect(err.code).toBe('conv_channel_config_invalid');
    expect(err.fieldErrors.map((fe) => fe.field)).toEqual(['outbound']);
    expect(err.message).toContain('conv_channel_config_invalid:');
  });

  it('does not couple stored-config failures to HTTP, since workers parse configs too', () => {
    expect(() => jsonbToStored(MISSING_OUTBOUND)).not.toThrow(HttpException);
  });
});

describe('tryJsonbToStored', () => {
  it('returns null instead of throwing so a full save can rebuild the config', () => {
    expect(tryJsonbToStored(MISSING_OUTBOUND)).toBeNull();
    expect(tryJsonbToStored(COMPLETE)).not.toBeNull();
  });
});
