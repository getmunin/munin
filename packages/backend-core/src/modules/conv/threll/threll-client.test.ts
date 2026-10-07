import { describe, it, expect } from 'vitest';
import { threllErrorDetail } from './threll-client.service.ts';

describe('threllErrorDetail', () => {
  it('reads a string message', () => {
    expect(threllErrorDetail({ message: 'worker has no outbound number' })).toBe(
      'worker has no outbound number',
    );
  });

  it('joins a validation message array', () => {
    expect(threllErrorDetail({ message: ['phoneNumber must be E.164', 'workerId is required'] })).toBe(
      'phoneNumber must be E.164; workerId is required',
    );
  });

  it('falls back to an error string when message is absent', () => {
    expect(threllErrorDetail({ error: 'Bad Request' })).toBe('Bad Request');
  });

  it('reads a nested error object message', () => {
    expect(threllErrorDetail({ error: { code: 'no_outbound', message: 'No outbound number' } })).toBe(
      'No outbound number',
    );
  });

  it('collects messages from an errors list of objects', () => {
    expect(threllErrorDetail({ errors: [{ message: 'a' }, { detail: 'b' }] })).toBe('a; b');
  });

  it('returns undefined for an empty or unrecognised body', () => {
    expect(threllErrorDetail({})).toBeUndefined();
    expect(threllErrorDetail({ message: '   ' })).toBeUndefined();
    expect(threllErrorDetail('not json')).toBeUndefined();
  });
});
