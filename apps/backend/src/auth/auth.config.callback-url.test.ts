import { describe, expect, it } from 'vitest';
import { ensureAbsoluteCallbackUrl } from './auth.config.ts';

describe('ensureAbsoluteCallbackUrl', () => {
  const verifyUrl = 'https://api.getmunin.com/auth/verify-email?token=abc&callbackURL=%2F';

  it('rewrites a relative callbackURL against webBaseUrl', () => {
    const result = ensureAbsoluteCallbackUrl(verifyUrl, 'https://app.getmunin.com');
    const callback = new URL(result).searchParams.get('callbackURL');
    expect(callback).toBe('https://app.getmunin.com/');
  });

  it('rewrites a relative path callbackURL against webBaseUrl', () => {
    const url = 'https://api.getmunin.com/auth/verify-email?token=abc&callbackURL=%2Fdashboard';
    const result = ensureAbsoluteCallbackUrl(url, 'https://app.getmunin.com');
    const callback = new URL(result).searchParams.get('callbackURL');
    expect(callback).toBe('https://app.getmunin.com/dashboard');
  });

  it('leaves an already-absolute callbackURL untouched', () => {
    const absolute = 'https://app.getmunin.com/welcome';
    const url = `https://api.getmunin.com/auth/verify-email?token=abc&callbackURL=${encodeURIComponent(absolute)}`;
    const result = ensureAbsoluteCallbackUrl(url, 'https://app.getmunin.com');
    expect(new URL(result).searchParams.get('callbackURL')).toBe(absolute);
  });

  it('returns the original url when webBaseUrl is missing', () => {
    expect(ensureAbsoluteCallbackUrl(verifyUrl, undefined)).toBe(verifyUrl);
  });

  it('returns the original url when there is no callbackURL param', () => {
    const url = 'https://api.getmunin.com/auth/verify-email?token=abc';
    expect(ensureAbsoluteCallbackUrl(url, 'https://app.getmunin.com')).toBe(url);
  });

  it('returns the original url when input is not a valid URL', () => {
    expect(ensureAbsoluteCallbackUrl('not a url', 'https://app.getmunin.com')).toBe('not a url');
  });
});
