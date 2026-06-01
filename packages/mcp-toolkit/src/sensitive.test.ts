import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { sensitive } from '@getmunin/types';
import { redactSensitive } from './sensitive.ts';

describe('redactSensitive', () => {
  it('redacts a top-level sensitive field', () => {
    const schema = z.object({
      name: z.string(),
      apiKey: sensitive(z.string()),
    });
    const out = redactSensitive(schema, { name: 'alice', apiKey: 'sk-live-abc' });
    expect(out).toEqual({ name: 'alice', apiKey: '[REDACTED]' });
  });

  it('redacts inside nested objects', () => {
    const schema = z.object({
      config: z.object({
        host: z.string(),
        password: sensitive(z.string()),
      }),
    });
    const out = redactSensitive(schema, {
      config: { host: 'smtp.example.com', password: 'hunter2' },
    });
    expect(out).toEqual({ config: { host: 'smtp.example.com', password: '[REDACTED]' } });
  });

  it('redacts inside a discriminated union variant', () => {
    const schema = z.object({
      outbound: z.discriminatedUnion('provider', [
        z.object({ provider: z.literal('smtp'), password: sensitive(z.string()) }),
        z.object({ provider: z.literal('mailer') }),
      ]),
    });
    const out = redactSensitive(schema, {
      outbound: { provider: 'smtp', password: 'hunter2' },
    });
    expect(out).toEqual({ outbound: { provider: 'smtp', password: '[REDACTED]' } });
  });

  it('redacts inside arrays', () => {
    const schema = z.object({
      tokens: z.array(z.object({ value: sensitive(z.string()) })),
    });
    const out = redactSensitive(schema, {
      tokens: [{ value: 'a' }, { value: 'b' }],
    });
    expect(out).toEqual({ tokens: [{ value: '[REDACTED]' }, { value: '[REDACTED]' }] });
  });

  it('preserves undefined for missing optional sensitive fields', () => {
    const schema = z.object({
      apiKey: sensitive(z.string().optional()),
    });
    expect(redactSensitive(schema, {})).toEqual({});
  });

  it('does not redact unmarked fields', () => {
    const schema = z.object({ public: z.string(), authToken: z.string() });
    const out = redactSensitive(schema, { public: 'p', authToken: 't' });
    expect(out).toEqual({ public: 'p', authToken: 't' });
  });

  it('handles refined object schemas (top-level .refine)', () => {
    const schema = z
      .object({ apiKey: sensitive(z.string()), name: z.string() })
      .refine((v) => v.name.length > 0);
    const out = redactSensitive(schema, { apiKey: 'sk', name: 'ok' });
    expect(out).toEqual({ apiKey: '[REDACTED]', name: 'ok' });
  });
});
