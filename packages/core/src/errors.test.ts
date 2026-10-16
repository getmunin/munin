import { describe, it, expect } from 'vitest';
import {
  describeError,
  isInternalError,
  redactQueryParams,
  redactQueryParamsDeep,
  sqlStateOf,
} from './errors.ts';

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

  it('redacts bound parameters anywhere in the cause chain', () => {
    const outer = new Error('allocate failed', {
      cause: new DrizzleQueryError('select $1', ['k3y']),
    });
    const described = describeError(outer);
    expect(described).not.toContain('k3y');
    expect(described).toContain('Failed query: select $1\nparams: [redacted]');
  });
});

class DrizzleQueryError extends Error {
  constructor(
    readonly query: string,
    readonly params: unknown[],
  ) {
    super(`Failed query: ${query}\nparams: ${params.join(',')}`);
  }
}

describe('redactQueryParams', () => {
  it('drops the bound parameters from a failed-query message and keeps the SQL', () => {
    const err = new DrizzleQueryError("SELECT set_config('app.crypt_key', $1, true)", ['k3y']);
    expect(redactQueryParams(err.message)).toBe(
      "Failed query: SELECT set_config('app.crypt_key', $1, true)\nparams: [redacted]",
    );
  });

  it('drops multi-line parameters from a stack trace without losing the frames', () => {
    const err = new DrizzleQueryError('insert into t values ($1, $2)', [
      'line one\nline two',
      'k3y',
    ]);
    const redacted = redactQueryParams(err.stack!);
    expect(redacted).not.toContain('k3y');
    expect(redacted).not.toContain('line two');
    expect(redacted).toContain('params: [redacted]\n    at ');
  });

  it('leaves text without a params segment alone', () => {
    expect(redactQueryParams('crm_conflict: email taken')).toBe('crm_conflict: email taken');
  });
});

describe('redactQueryParamsDeep', () => {
  it('redacts strings and errors nested inside an event-shaped object', () => {
    const event = {
      exception: { values: [{ value: 'Failed query: select $1\nparams: k3y' }] },
      breadcrumbs: [
        { message: 'ok' },
        { data: { arguments: [new DrizzleQueryError('select $1', ['k3y'])] } },
      ],
    };
    const out = JSON.stringify(redactQueryParamsDeep(event));
    expect(out).not.toContain('k3y');
    expect(out).toContain('params: [redacted]');
  });
});

describe('isInternalError', () => {
  it.each([
    ['a drizzle query error', new DrizzleQueryError('select 1', [])],
    [
      'a postgres server error',
      Object.assign(new Error('deadlock detected'), { severity: 'ERROR', code: '40P01' }),
    ],
    [
      'a postgres driver error carrying its query',
      Object.assign(new Error('boom'), { query: 'select 1', parameters: [] }),
    ],
    [
      'a socket error',
      Object.assign(new Error('connect ECONNREFUSED'), { errno: -61, syscall: 'connect' }),
    ],
    ['a TypeError', new TypeError('x is not a function')],
    ['a RangeError', new RangeError('Invalid time value')],
    [
      'a plain error that embeds a failed query',
      new Error('wrapped: Failed query: select 1\nparams: 1'),
    ],
    ['a thrown string', 'boom'],
    ['a thrown object', { code: 'E' }],
  ])('treats %s as internal', (_label, err) => {
    expect(isInternalError(err)).toBe(true);
  });

  it.each([
    ['a plain coded error', new Error('twilio_21211: invalid To number')],
    [
      'a domain error subclass',
      new (class KbConflictError extends Error {})('kb_conflict: version moved'),
    ],
    [
      'an error with a non-SQLSTATE code',
      Object.assign(new Error('messagebird_2: bad request'), { code: 'messagebird_2' }),
    ],
  ])('treats %s as deliberate', (_label, err) => {
    expect(isInternalError(err)).toBe(false);
  });
});

describe('sqlStateOf', () => {
  it('finds the SQLSTATE on the cause of a wrapping error', () => {
    const cause = Object.assign(new Error('dup'), { code: '23505' });
    expect(sqlStateOf(new Error('outer', { cause }))).toBe('23505');
  });

  it('returns null when nothing in the chain carries one', () => {
    expect(sqlStateOf(new Error('plain'))).toBeNull();
  });
});
