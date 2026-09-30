import { describe, expect, it } from 'vitest';
import { securityHeaderRoutes } from './security-headers.mjs';

describe('securityHeaderRoutes', () => {
  it('applies one header set to every route, the root included', async () => {
    const routes = await securityHeaderRoutes();
    expect(routes).toHaveLength(1);
    expect(routes[0].source).toBe('/:path*');
  });

  it('refuses framing of login, consent and dashboard pages by any origin', async () => {
    const [route] = await securityHeaderRoutes();
    const byKey = new Map(route.headers.map((h) => [h.key.toLowerCase(), h.value]));
    expect(byKey.get('x-frame-options')).toBe('DENY');
    expect(byKey.get('content-security-policy')).toBe("frame-ancestors 'none'");
    expect(byKey.get('x-content-type-options')).toBe('nosniff');
    expect(byKey.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
  });

  it('keeps the CSP limited to frame-ancestors so no script or style source is restricted yet', async () => {
    const [route] = await securityHeaderRoutes();
    const csp = route.headers.find((h) => h.key === 'Content-Security-Policy').value;
    expect(csp).not.toMatch(/script-src|default-src|style-src/);
  });
});
