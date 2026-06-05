import { describe, it, expect } from 'vitest';
import { describeError } from './errors.ts';

describe('describeError', () => {
  it('formats a plain error with its name and message', () => {
    expect(describeError(new Error('boom'))).toBe('Error: boom');
  });

  it('includes the errno code when present', () => {
    const err = Object.assign(new Error('getaddrinfo failed'), { code: 'ENOTFOUND' });
    expect(describeError(err)).toBe('Error[ENOTFOUND]: getaddrinfo failed');
  });

  it('walks the cause chain and joins links', () => {
    const inner = Object.assign(new Error('socket closed'), { code: 'ECONNRESET' });
    const outer = new TypeError('fetch failed', { cause: inner });
    expect(describeError(outer)).toBe(
      'TypeError: fetch failed <- Error[ECONNRESET]: socket closed',
    );
  });

  it('caps recursion depth', () => {
    const a = new Error('a');
    const b = new Error('b', { cause: a });
    const c = new Error('c', { cause: b });
    expect(describeError(c, 2)).toBe('Error: c <- Error: b');
  });

  it('handles non-Error causes', () => {
    const outer = new Error('outer');
    (outer as { cause?: unknown }).cause = 'bare string reason';
    expect(describeError(outer)).toBe('Error: outer <- bare string reason');
  });

  it('handles undefined gracefully', () => {
    expect(describeError(undefined)).toBe('');
  });

  it('JSON-stringifies object causes instead of [object Object]', () => {
    const outer = new Error('outer');
    (outer as { cause?: unknown }).cause = { code: 'E_WEIRD', detail: 'thing' };
    expect(describeError(outer)).toBe('Error: outer <- {"code":"E_WEIRD","detail":"thing"}');
  });
});
