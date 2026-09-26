import { describe, expect, it } from 'vitest';
import { coverageNoticeFor } from './pii-coverage';

const status = (withholdUncheckedText: boolean, nerEnabled: boolean, messages: number, annotated: number) => ({
  withholdUncheckedText,
  nerEnabled,
  coverage: { messages, annotated },
});

describe('coverageNoticeFor', () => {
  it('warns that unknown names can appear while name detection is catching up', () => {
    expect(coverageNoticeFor(status(false, true, 100, 40))).toBe('pending');
  });

  it('warns that unknown names always appear when name detection is not running', () => {
    expect(coverageNoticeFor(status(false, false, 100, 0))).toBe('noNer');
  });

  it('says nothing once every message has been checked', () => {
    expect(coverageNoticeFor(status(false, true, 100, 100))).toBeNull();
    expect(coverageNoticeFor(status(true, true, 100, 100))).toBeNull();
  });

  it('reports what strict mode is withholding instead', () => {
    expect(coverageNoticeFor(status(true, true, 100, 40))).toBe('withheldPending');
    expect(coverageNoticeFor(status(true, false, 100, 0))).toBe('withheldNoNer');
  });
});
