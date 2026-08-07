import { describe, it, expect } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { ZodValidationPipe } from './zod-validation.pipe.ts';

class SampleBody extends createZodDto(
  z.object({
    host: z.string().min(1),
    port: z.number().int().min(1).max(65535),
    nested: z.object({ label: z.string().min(1) }).optional(),
  }),
) {}

const metadata = { type: 'body' as const, metatype: SampleBody };

function runPipe(value: unknown): unknown {
  return new ZodValidationPipe().transform(value, metadata);
}

function expectBadRequest(value: unknown): Record<string, unknown> {
  try {
    runPipe(value);
  } catch (err) {
    expect(err).toBeInstanceOf(BadRequestException);
    return (err as BadRequestException).getResponse() as Record<string, unknown>;
  }
  throw new Error('expected the pipe to reject the value');
}

function readFieldErrors(response: Record<string, unknown>): Array<{
  field: string;
  message: string;
}> {
  return response.fieldErrors as Array<{ field: string; message: string }>;
}

describe('ZodValidationPipe', () => {
  it('returns the parsed value when the body satisfies the schema', () => {
    expect(runPipe({ host: 'smtp.example.com', port: 587 })).toEqual({
      host: 'smtp.example.com',
      port: 587,
    });
  });

  it('reports each invalid field in fieldErrors so dashboard forms can bind them', () => {
    const fieldErrors = readFieldErrors(expectBadRequest({ host: '', port: 99999 }));
    expect(fieldErrors.map((fe) => fe.field)).toEqual(['host', 'port']);
    expect(fieldErrors.filter((fe) => fe.message.length > 0)).toHaveLength(2);
  });

  it('dots nested paths in fieldErrors field names', () => {
    const fieldErrors = readFieldErrors(
      expectBadRequest({ host: 'smtp.example.com', port: 587, nested: { label: '' } }),
    );
    expect(fieldErrors.map((fe) => fe.field)).toEqual(['nested.label']);
  });

  it('summarises every issue into the message rather than a bare Validation failed', () => {
    const response = expectBadRequest({ host: '', port: 99999 });
    expect(response.message).toMatch(/^validation_failed: /);
    expect(response.message).toContain('host:');
    expect(response.message).toContain('port:');
  });

  it('leaves parameters that are not nestjs-zod DTOs untouched', () => {
    const raw = { anything: 'goes' };
    expect(new ZodValidationPipe().transform(raw, { type: 'body', metatype: Object })).toBe(raw);
  });

  it('still enforces cross-field refinements wrapped by createZodDto', () => {
    class RefinedBody extends createZodDto(
      z
        .object({ accountSid: z.string().min(1), authToken: z.string().min(1) })
        .refine((v) => v.accountSid.startsWith('AC'), {
          message: 'accountSid must start with AC',
          path: ['accountSid'],
        }),
    ) {}
    const refinedMetadata = { type: 'body' as const, metatype: RefinedBody };
    expect(
      new ZodValidationPipe().transform({ accountSid: 'ACxxx', authToken: 't' }, refinedMetadata),
    ).toEqual({ accountSid: 'ACxxx', authToken: 't' });
    let caught: unknown;
    try {
      new ZodValidationPipe().transform({ accountSid: 'ZZxxx', authToken: 't' }, refinedMetadata);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(BadRequestException);
    expect((caught as BadRequestException).getResponse()).toMatchObject({
      fieldErrors: [{ field: 'accountSid', message: 'accountSid must start with AC' }],
    });
  });
});
