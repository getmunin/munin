import { describe, it, expect } from 'vitest';
import { MAX_INGEST_FIELD_LENGTH, truncatedString } from './ingest-fields.ts';

describe('truncatedString', () => {
  it('leaves a value inside the limit untouched', () => {
    expect(truncatedString(512).parse('/dashboard/oauth/consent')).toBe(
      '/dashboard/oauth/consent',
    );
  });

  it('truncates instead of rejecting, so an over-long field never drops the event', () => {
    const consentPath = '/en/dashboard/oauth/consent?scope=' + 'a'.repeat(1000);
    const parsed = truncatedString(512).safeParse(consentPath);
    expect(parsed.success).toBe(true);
    expect(parsed.data).toHaveLength(512);
    expect(parsed.data).toBe(consentPath.slice(0, 512));
  });

  it('keeps the pathname intact when only the query string overflows', () => {
    const path = '/en/dashboard/oauth/consent?state=' + 'b'.repeat(900);
    expect(truncatedString(512).parse(path)).toMatch(
      /^\/en\/dashboard\/oauth\/consent\?state=b+$/,
    );
  });

  it('still rejects a field far past any legitimate URL, bounding body size', () => {
    expect(truncatedString(512).safeParse('x'.repeat(MAX_INGEST_FIELD_LENGTH + 1)).success).toBe(
      false,
    );
  });
});
