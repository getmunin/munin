import { describe, expect, it } from 'vitest';
import { readableReason } from './social-oauth.controller.ts';

describe('readableReason', () => {
  it("carries the platform's own explanation through, which is the only thing that names the cause", () => {
    expect(readableReason('Scope+&quot;openid&quot;+is+not+authorized+for+your+application')).toBe(
      'Scope "openid" is not authorized for your application',
    );
  });

  it('drops control characters rather than letting them into a redirect', () => {
    expect(readableReason('bad reason\nhere')).toBe('bad reason here');
  });

  it('caps a long reason so it cannot bloat the redirect URL', () => {
    expect(readableReason('x'.repeat(500))).toHaveLength(200);
  });

  it('returns null for nothing worth showing, so the generic message stands', () => {
    expect(readableReason(undefined)).toBeNull();
    expect(readableReason('   ')).toBeNull();
  });
});
