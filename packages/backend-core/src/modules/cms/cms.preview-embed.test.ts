import { describe, expect, it } from 'vitest';
import { evaluateFrameHeaders } from './cms.preview-embed.ts';

const PREVIEW = new URL('https://threll.ai/api/preview?token=x');
const DASHBOARD = new URL('https://app.getmunin.com');

function evaluate(csp: string | null, xfo: string | null, preview = PREVIEW) {
  return evaluateFrameHeaders({ csp, xfo }, preview, DASHBOARD);
}

describe('evaluateFrameHeaders', () => {
  it('allows a site that sends neither header', () => {
    expect(evaluate(null, null)).toEqual({ embeddable: true, reason: 'ok', detail: null });
  });

  it("blocks frame-ancestors 'none' and reports the source list", () => {
    expect(evaluate("frame-ancestors 'none'", 'DENY')).toEqual({
      embeddable: false,
      reason: 'frame_ancestors',
      detail: "'none'",
    });
  });

  it('allows an exact origin, a wildcard subdomain and a bare scheme', () => {
    expect(evaluate('frame-ancestors https://app.getmunin.com', null).embeddable).toBe(true);
    expect(evaluate('frame-ancestors *.getmunin.com', null).embeddable).toBe(true);
    expect(evaluate('frame-ancestors https:', null).embeddable).toBe(true);
    expect(evaluate('frame-ancestors *', null).embeddable).toBe(true);
  });

  it('rejects a neighbouring host and a mismatched scheme or port', () => {
    expect(
      evaluate('frame-ancestors https://evil.getmunin.com.attacker.test', null).embeddable,
    ).toBe(false);
    expect(evaluate('frame-ancestors http://app.getmunin.com', null).embeddable).toBe(false);
    expect(evaluate('frame-ancestors https://app.getmunin.com:8443', null).embeddable).toBe(false);
    expect(evaluate('frame-ancestors getmunin.com', null).embeddable).toBe(false);
  });

  it("reads 'self' against the previewed site, not the dashboard", () => {
    expect(evaluate("frame-ancestors 'self'", null).embeddable).toBe(false);
    const sameOrigin = new URL('https://app.getmunin.com/preview');
    expect(evaluate("frame-ancestors 'self'", null, sameOrigin).embeddable).toBe(true);
  });

  it('enforces every policy when several are combined into one header', () => {
    const csp = 'frame-ancestors https://app.getmunin.com, frame-ancestors https://other.test';
    expect(evaluate(csp, null)).toEqual({
      embeddable: false,
      reason: 'frame_ancestors',
      detail: 'https://other.test',
    });
  });

  it('ignores X-Frame-Options when frame-ancestors is present, as browsers do', () => {
    expect(evaluate('frame-ancestors https://app.getmunin.com', 'DENY').embeddable).toBe(true);
  });

  it('falls back to X-Frame-Options when no frame-ancestors is set', () => {
    expect(evaluate('default-src *', 'DENY')).toEqual({
      embeddable: false,
      reason: 'x_frame_options',
      detail: 'DENY',
    });
    expect(evaluate(null, 'SAMEORIGIN').embeddable).toBe(false);
    expect(evaluate(null, 'SAMEORIGIN', new URL('https://app.getmunin.com/x')).embeddable).toBe(
      true,
    );
    expect(evaluate(null, 'ALLOW-FROM https://app.getmunin.com').embeddable).toBe(true);
  });

  it('blocks an empty frame-ancestors list rather than reading it as permissive', () => {
    expect(evaluate('frame-ancestors', null).embeddable).toBe(false);
  });
});
