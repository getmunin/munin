import { describe, it, expect } from 'vitest';
import { verifyVapiWebhookSecret } from './vapi-client.service.js';

describe('verifyVapiWebhookSecret', () => {
  const expected = 'vapi-shared-secret';

  it('accepts the matching secret', () => {
    expect(verifyVapiWebhookSecret({ expected, provided: expected })).toBe(true);
  });

  it('trims surrounding whitespace from the provided value', () => {
    expect(verifyVapiWebhookSecret({ expected, provided: `  ${expected}  ` })).toBe(true);
  });

  it('rejects a mismatched secret of the same length', () => {
    const bad = expected.replace(/.$/, (c) => (c === 'a' ? 'b' : 'a'));
    expect(verifyVapiWebhookSecret({ expected, provided: bad })).toBe(false);
  });

  it('rejects a different-length secret', () => {
    expect(verifyVapiWebhookSecret({ expected, provided: `${expected}-extra` })).toBe(false);
  });

  it('rejects empty provided value', () => {
    expect(verifyVapiWebhookSecret({ expected, provided: '' })).toBe(false);
  });
});
