import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sentryForwardingLogger } from './auth.config.ts';

type CaptureHint = { tags?: Record<string, string>; extra?: Record<string, unknown> };
type CaptureCall = [unknown, CaptureHint?];

describe('sentryForwardingLogger', () => {
  let calls: CaptureCall[];
  let capture: (err: unknown, hint?: CaptureHint) => unknown;
  let consoleError: ReturnType<typeof vi.spyOn>;
  let consoleLog: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    calls = [];
    capture = (err, hint) => {
      calls.push([err, hint]);
      return undefined;
    };
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
    consoleLog.mockRestore();
  });

  it('forwards Errors from error-level logs to captureException', () => {
    const logger = sentryForwardingLogger(capture);
    const err = new Error('boom');
    logger.log!('error', 'Failed to run background task', err);

    expect(calls).toHaveLength(1);
    const [reported, hint] = calls[0]!;
    expect(reported).toBe(err);
    expect(hint).toEqual({
      tags: { source: 'better-auth' },
      extra: { message: 'Failed to run background task', args: [] },
    });
  });

  it('synthesises an Error when error-level logs carry none', () => {
    const logger = sentryForwardingLogger(capture);
    logger.log!('error', 'something went sideways', { detail: 42 });

    expect(calls).toHaveLength(1);
    const [reported, hint] = calls[0]!;
    expect(reported).toBeInstanceOf(Error);
    expect((reported as Error).message).toBe('[BetterAuth] something went sideways');
    expect(hint).toEqual({
      tags: { source: 'better-auth' },
      extra: { message: 'something went sideways', args: [{ detail: 42 }] },
    });
  });

  it('does not capture non-error log levels', () => {
    const logger = sentryForwardingLogger(capture);
    logger.log!('warn', 'heads up', new Error('still ignored'));
    logger.log!('info', 'just info');
    logger.log!('debug', 'debug');

    expect(calls).toHaveLength(0);
  });
});
