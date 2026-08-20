import { describe, expect, it } from 'vitest';
import { clientLabel, clientTitle } from './audit-client.ts';

describe('clientLabel', () => {
  it('names the calling origin host for a third-party browser caller', () => {
    expect(clientLabel('browser', 'https://docs.getmunin.com')).toBe('docs.getmunin.com');
  });

  it('keeps the port so two local surfaces stay distinguishable', () => {
    expect(clientLabel('browser', 'http://localhost:4000')).toBe('localhost:4000');
  });

  it('falls back to the kind when a browser row carries no origin header', () => {
    expect(clientLabel('browser', null)).toBe('browser');
    expect(clientLabel('browser', 'not a url')).toBe('browser');
  });

  it('leaves every other kind as the bare kind', () => {
    expect(clientLabel('dashboard', 'https://app.getmunin.com')).toBe('dashboard');
    expect(clientLabel('mcp', null)).toBe('mcp');
    expect(clientLabel('unknown', null)).toBe('unknown');
  });
});

describe('clientTitle', () => {
  it('stacks origin and user agent, skipping the missing ones', () => {
    expect(clientTitle('https://docs.getmunin.com', 'Mozilla/5.0')).toBe(
      'https://docs.getmunin.com\nMozilla/5.0',
    );
    expect(clientTitle(null, 'curl/8.4.0')).toBe('curl/8.4.0');
    expect(clientTitle(null, null)).toBeUndefined();
  });
});
