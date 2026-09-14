import { describe, expect, it } from 'vitest';
import { hasNoAnswerableContent, isContentlessBody, isMachineSubject } from './classify-content.ts';

describe('isContentlessBody', () => {
  it('treats an empty or whitespace-only body as carrying nothing', () => {
    expect(isContentlessBody(null)).toBe(true);
    expect(isContentlessBody('')).toBe(true);
    expect(isContentlessBody('   \n\t ')).toBe(true);
  });

  it('treats a body that is only a link as carrying nothing', () => {
    expect(isContentlessBody('https://european-union.europa.eu/accessibility-statement_en')).toBe(true);
    expect(isContentlessBody('https://youtube.com/shorts/PG2CDjhxcXs?is=9jMgBanPOxoKpcM8')).toBe(true);
    expect(isContentlessBody('  www.example.test/page  \n\n ')).toBe(true);
  });

  it('keeps a body that says anything at all beyond the link', () => {
    expect(isContentlessBody('Is this page broken? https://example.test/x')).toBe(false);
    expect(isContentlessBody('hei')).toBe(false);
    expect(isContentlessBody('2')).toBe(false);
  });

  it('counts bare punctuation as nothing, so it can only ever suppress under a machine subject too', () => {
    expect(isContentlessBody('?')).toBe(true);
    expect(isContentlessBody('---')).toBe(true);
  });
});

describe('isMachineSubject', () => {
  it('recognises the subjects a phone or mail client writes for you', () => {
    expect(isMachineSubject('')).toBe(true);
    expect(isMachineSubject('12 сентября 2026 г.')).toBe(true);
    expect(isMachineSubject('Screenshot (11 сентября 2026)')).toBe(true);
    expect(isMachineSubject('Image attachment')).toBe(true);
    expect(isMachineSubject('IMG_20260911')).toBe(true);
    expect(isMachineSubject('Fwd:')).toBe(true);
    expect(isMachineSubject('https://example.test/page')).toBe(true);
  });

  it('keeps any subject a person wrote, however terse', () => {
    expect(isMachineSubject('Callback request')).toBe(false);
    expect(isMachineSubject('UBS Wealth Management consultation request')).toBe(false);
    expect(isMachineSubject('Error')).toBe(false);
    expect(isMachineSubject('Re: Order never arrived')).toBe(false);
  });
});

describe('hasNoAnswerableContent', () => {
  it('suppresses only when neither half says anything', () => {
    expect(
      hasNoAnswerableContent({
        subject: '12 сентября 2026 г.',
        bodyText: 'https://youtube.com/shorts/PG2CDjhxcXs',
      }),
    ).toBe(true);
    expect(hasNoAnswerableContent({ subject: null, bodyText: '' })).toBe(true);
  });

  it('leaves a plausible subject alone even when the body is empty, because a terse enquiry looks exactly like this', () => {
    expect(hasNoAnswerableContent({ subject: 'Callback request', bodyText: '' })).toBe(false);
    expect(
      hasNoAnswerableContent({
        subject: 'UBS Wealth Management consultation request',
        bodyText: null,
      }),
    ).toBe(false);
  });

  it('leaves a real body alone even under a machine subject', () => {
    expect(
      hasNoAnswerableContent({
        subject: 'Screenshot 2026-09-11',
        bodyText: 'This error shows every time I try to pay.',
      }),
    ).toBe(false);
  });
});
