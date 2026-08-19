import { describe, expect, it } from 'vitest';
import { HttpStatus, type CallHandler, type ExecutionContext } from '@nestjs/common';
import { firstValueFrom, throwError } from 'rxjs';
import { z } from 'zod';
import {
  ChannelConfigErrorInterceptor,
  ChannelConfigInvalidError,
  parseStoredConfig,
  tryParseStoredConfig,
} from './stored-config.ts';

const Schema = z.object({
  outbound: z.object({ provider: z.literal('smtp') }),
});

function runInterceptor(err: unknown): Promise<unknown> {
  const interceptor = new ChannelConfigErrorInterceptor();
  const next: CallHandler = { handle: () => throwError(() => err) };
  return firstValueFrom(
    interceptor.intercept({} as ExecutionContext, next) as ReturnType<CallHandler['handle']>,
  );
}

describe('parseStoredConfig', () => {
  it('names every distinct invalid path once', () => {
    let thrown: unknown;
    try {
      parseStoredConfig(Schema, {}, 'email');
    } catch (err) {
      thrown = err;
    }
    const err = thrown as ChannelConfigInvalidError;
    expect(err).toBeInstanceOf(ChannelConfigInvalidError);
    expect(err.fieldErrors.map((fe) => fe.field)).toEqual(['outbound']);
    expect(err.message).toContain("this email channel's saved settings are incomplete");
  });

  it('returns the parsed value when the config is valid', () => {
    expect(parseStoredConfig(Schema, { outbound: { provider: 'smtp' } }, 'email').outbound.provider).toBe(
      'smtp',
    );
  });
});

describe('tryParseStoredConfig', () => {
  it('returns null rather than throwing', () => {
    expect(tryParseStoredConfig(Schema, {})).toBeNull();
  });
});

describe('ChannelConfigErrorInterceptor', () => {
  it('maps a corrupt stored config to 500, since the caller cannot fix it by changing the request', async () => {
    const err = await runInterceptor(new ChannelConfigInvalidError('email', [
      { field: 'outbound', message: 'required' },
    ])).catch((e: unknown) => e);

    const mapped = err as { getStatus: () => number; getResponse: () => unknown };
    expect(mapped.getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(mapped.getResponse()).toMatchObject({
      code: 'conv_channel_config_invalid',
      fieldErrors: [{ field: 'outbound', message: 'required' }],
    });
  });

  it('passes every other error through untouched', async () => {
    const original = new Error('unrelated');
    const err = await runInterceptor(original).catch((e: unknown) => e);
    expect(err).toBe(original);
  });
});
