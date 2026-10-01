import { describe, it, expect } from 'vitest';
import {
  ProviderError,
  affectsProviderHealth,
  parseRetryAfterMs,
  rateLimitRetryDelayMs,
} from './transport.ts';

describe('rateLimitRetryDelayMs', () => {
  it('grows exponentially across attempts', () => {
    const half = (): number => 0;
    expect(rateLimitRetryDelayMs(null, 0, half)).toBe(500);
    expect(rateLimitRetryDelayMs(null, 1, half)).toBe(1_000);
    expect(rateLimitRetryDelayMs(null, 2, half)).toBe(2_000);
  });

  it('jitters so that concurrent callers do not retry in lockstep', () => {
    expect(rateLimitRetryDelayMs(null, 0, () => 0)).toBe(500);
    expect(rateLimitRetryDelayMs(null, 0, () => 1)).toBe(1_000);
  });

  it('never waits less than the provider asked for', () => {
    expect(rateLimitRetryDelayMs('3', 0, () => 0)).toBe(3_000);
  });

  it('caps the wait', () => {
    expect(rateLimitRetryDelayMs('600', 4, () => 1)).toBe(15_000);
  });
});

describe('parseRetryAfterMs', () => {
  it('reads delay-seconds', () => {
    expect(parseRetryAfterMs('2')).toBe(2_000);
  });

  it('reads an HTTP date', () => {
    const at = new Date(Date.now() + 4_000).toUTCString();
    const ms = parseRetryAfterMs(at);
    expect(ms).toBeGreaterThan(2_000);
    expect(ms).toBeLessThanOrEqual(5_000);
  });

  it('returns null for a missing or unparseable header', () => {
    expect(parseRetryAfterMs(null)).toBeNull();
    expect(parseRetryAfterMs('soon')).toBeNull();
  });
});

describe('ProviderError context-length classification', () => {
  it.each([
    [400, `provider returned 400: {"error":{"message":"Input length (165979) exceeds model's maximum context length (131072)."}}`],
    [400, "provider returned 400: This model's maximum context length is 128000 tokens. However, your messages resulted in 140000 tokens."],
    [400, 'provider returned 400: {"error":{"code":"context_length_exceeded"}}'],
    [400, 'provider returned 400: prompt is too long: 210000 tokens > 200000 maximum'],
    [413, 'provider returned 413: request exceeds the context window'],
  ])('classifies %i "%s" as provider_context_length', (status, message) => {
    expect(new ProviderError(message, status).code).toBe('provider_context_length');
  });

  it('leaves other 400s as provider_other', () => {
    expect(new ProviderError('provider returned 400: invalid tool schema', 400).code).toBe(
      'provider_other',
    );
  });

  it('does not count a context overflow against provider health', () => {
    expect(affectsProviderHealth('provider_context_length')).toBe(false);
    expect(affectsProviderHealth('provider_other')).toBe(true);
    expect(affectsProviderHealth('provider_auth')).toBe(true);
  });
});
