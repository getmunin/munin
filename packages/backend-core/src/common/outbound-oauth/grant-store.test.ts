import { describe, it, expect } from 'vitest';
import { OutboundOAuthStore } from './grant-store.ts';

describe('resolveOrMarkRevoked', () => {
  const store = new OutboundOAuthStore();

  it('returns the token and leaves the record alone when the grant still works', async () => {
    let marked = 0;
    const token = await store.resolveOrMarkRevoked({
      attempt: () => Promise.resolve({ token: 'at_live' }),
      onRevoked: () => {
        marked += 1;
        return Promise.resolve();
      },
      revokedError: () => new Error('unused'),
    });
    expect(token).toBe('at_live');
    expect(marked).toBe(0);
  });

  it('records the revocation before it throws, so the marker survives the error', async () => {
    const order: string[] = [];
    await expect(
      store.resolveOrMarkRevoked({
        attempt: () => Promise.resolve({ revoked: 'grant withdrawn' }),
        onRevoked: (reason) => {
          order.push(`marked:${reason}`);
          return Promise.resolve();
        },
        revokedError: (reason) => {
          order.push('threw');
          return new Error(`expired: ${reason}`);
        },
      }),
    ).rejects.toThrow('expired: grant withdrawn');
    expect(order).toEqual(['marked:grant withdrawn', 'threw']);
  });

  it('lets a failure to record the revocation surface rather than reporting a clean expiry', async () => {
    await expect(
      store.resolveOrMarkRevoked({
        attempt: () => Promise.resolve({ revoked: 'gone' }),
        onRevoked: () => Promise.reject(new Error('write failed')),
        revokedError: () => new Error('expired'),
      }),
    ).rejects.toThrow('write failed');
  });

  it('does not swallow an error thrown while attempting the refresh', async () => {
    await expect(
      store.resolveOrMarkRevoked({
        attempt: () => Promise.reject(new Error('vendor 500')),
        onRevoked: () => Promise.resolve(),
        revokedError: () => new Error('expired'),
      }),
    ).rejects.toThrow('vendor 500');
  });
});
