import { test, expect } from '@playwright/test';

const REQUEST_TIMEOUT = 120_000;

test.describe('OSS not-found status codes', () => {
  test('an unknown skill answers a real 404, not a streamed soft 404', async ({ request }) => {
    test.setTimeout(REQUEST_TIMEOUT * 2);
    const res = await request.get('/en/docs/skills/no-such-module/no-such-skill', {
      timeout: REQUEST_TIMEOUT,
    });
    expect(res.status()).toBe(404);
  });

  test('a real skill still answers 200', async ({ request }) => {
    test.setTimeout(REQUEST_TIMEOUT * 3);
    const index = await request.get('/en/docs/skills', { timeout: REQUEST_TIMEOUT });
    expect(index.status()).toBe(200);
    const match = (await index.text()).match(/\/en\/docs\/skills\/[a-z0-9-]+\/[a-z0-9-]+/);
    expect(match).not.toBeNull();
    const res = await request.get(match?.[0] ?? '', { timeout: REQUEST_TIMEOUT });
    expect(res.status()).toBe(200);
  });

  test('an unrouted path answers 404', async ({ request }) => {
    test.setTimeout(REQUEST_TIMEOUT * 2);
    const res = await request.get('/en/definitely-not-a-route', { timeout: REQUEST_TIMEOUT });
    expect(res.status()).toBe(404);
  });
});
