import { describe, it, expect } from 'vitest';
import { isOptOutKeyword } from './channel-ingest.service.ts';

describe('isOptOutKeyword', () => {
  it('matches the English carrier keywords regardless of case or trailing punctuation', () => {
    for (const body of ['STOP', 'stop', ' Stop ', 'STOP.', 'unsubscribe', 'QUIT', 'end', 'cancel']) {
      expect(isOptOutKeyword(body), body).toBe(true);
    }
  });

  it('matches the Norwegian keywords a Nordic recipient would actually send', () => {
    for (const body of ['STOPP', 'stopp', 'SLUTT', 'slutt', 'avmeld']) {
      expect(isOptOutKeyword(body), body).toBe(true);
    }
  });

  it('does not match a sentence that merely contains an opt-out word', () => {
    for (const body of [
      'can you stop the renewal on my account?',
      'please cancel my order',
      'stop by the shop tomorrow',
      'I want to unsubscribe from the newsletter but keep my account',
    ]) {
      expect(isOptOutKeyword(body), body).toBe(false);
    }
  });

  it('does not match an empty or whitespace-only body', () => {
    expect(isOptOutKeyword('')).toBe(false);
    expect(isOptOutKeyword('   ')).toBe(false);
  });
});
