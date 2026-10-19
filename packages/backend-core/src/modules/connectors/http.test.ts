import { describe, expect, it } from 'vitest';
import { ResponseTooLargeError } from '@getmunin/core';
import { asVendorError, ConnectorVendorError } from './http.ts';

describe('asVendorError', () => {
  it('turns an oversized vendor response into a vendor error that names the cap', () => {
    const mapped = asVendorError(new ResponseTooLargeError(2048));
    expect(mapped).toBeInstanceOf(ConnectorVendorError);
    expect((mapped as Error).message).toMatch(/larger than the 2048-byte limit \(response_too_large\)/);
  });

  it('finds the oversized response behind a wrapping error', () => {
    const wrapped = new Error('fetch failed', { cause: new ResponseTooLargeError(2048) });
    expect(asVendorError(wrapped)).toBeInstanceOf(ConnectorVendorError);
  });

  it('passes every other error through untouched', () => {
    const other = new TypeError('boom');
    expect(asVendorError(other)).toBe(other);
  });
});
