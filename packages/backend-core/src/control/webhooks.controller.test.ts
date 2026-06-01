import { describe, expect, it } from 'vitest';
import { WebhookUrl } from './webhooks.controller.ts';

describe('Webhook URL schema', () => {
  it('accepts a public https URL', () => {
    expect(WebhookUrl.safeParse('https://hooks.example.com/munin').success).toBe(true);
  });

  it('rejects plain http://', () => {
    expect(WebhookUrl.safeParse('http://hooks.example.com/munin').success).toBe(false);
  });

  it('rejects non-http(s) schemes', () => {
    expect(WebhookUrl.safeParse('ftp://hooks.example.com/').success).toBe(false);
    expect(WebhookUrl.safeParse('file:///etc/passwd').success).toBe(false);
    expect(WebhookUrl.safeParse('gopher://evil/').success).toBe(false);
  });

  it('rejects malformed input', () => {
    expect(WebhookUrl.safeParse('not a url').success).toBe(false);
  });

  it('passes schema check for http localhost (private-IP block enforced by safeFetch at delivery)', () => {
    expect(WebhookUrl.safeParse('http://localhost/').success).toBe(false);
    expect(WebhookUrl.safeParse('http://127.0.0.1/').success).toBe(false);
    expect(WebhookUrl.safeParse('https://127.0.0.1/').success).toBe(true);
  });
});
