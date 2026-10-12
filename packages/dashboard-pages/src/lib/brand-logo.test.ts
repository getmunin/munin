import { describe, expect, it } from 'vitest';
import { MUNIN_LOGO_SRC, logoDarkClass } from './brand-logo';

describe('logoDarkClass', () => {
  it('inverts the monochrome Munin mark on a dark scheme', () => {
    expect(logoDarkClass(MUNIN_LOGO_SRC)).toBe('dark:invert');
  });

  it('leaves a custom logo in its own colours', () => {
    expect(logoDarkClass('/acme-logo.png')).toBeUndefined();
  });
});
