import { describe, it, expect } from 'vitest';
import { readableOn, INK, PAPER } from './color.ts';

describe('readableOn', () => {
  it('returns paper on dark backgrounds', () => {
    expect(readableOn('#0F1419')).toBe(PAPER);
    expect(readableOn('#000')).toBe(PAPER);
    expect(readableOn('#6E2BD9')).toBe(PAPER);
  });

  it('returns ink on light backgrounds', () => {
    expect(readableOn('#FFFFFF')).toBe(INK);
    expect(readableOn('#fff')).toBe(INK);
    expect(readableOn('#FFE066')).toBe(INK);
    expect(readableOn('#E8E4DC')).toBe(INK);
  });

  it('ignores an alpha channel', () => {
    expect(readableOn('#FFFFFF80')).toBe(INK);
    expect(readableOn('#000f')).toBe(PAPER);
  });

  it('falls back to paper on an unparseable color', () => {
    expect(readableOn('rebeccapurple')).toBe(PAPER);
    expect(readableOn('#12')).toBe(PAPER);
  });
});
