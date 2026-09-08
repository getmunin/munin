import { describe, it, expect } from 'vitest';
import { contrastFloor, readableOn, INK, PAPER } from './color.ts';

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

function ratio(a: string, b: string): number {
  const lum = (hex: string) => {
    const raw = hex.replace('#', '');
    const ch = [0, 2, 4].map((i) => {
      const c = parseInt(raw.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    }) as [number, number, number];
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  };
  const [hi, lo] = lum(a) > lum(b) ? [lum(a), lum(b)] : [lum(b), lum(a)];
  return (hi + 0.05) / (lo + 0.05);
}

const SWEEP: string[] = [];
for (let r = 0; r < 256; r += 15)
  for (let g = 0; g < 256; g += 15)
    for (let b = 0; b < 256; b += 15)
      SWEEP.push('#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join(''));

describe('readableOn contrast floor', () => {
  it('never returns a foreground below the 4.5:1 AA threshold', () => {
    for (const bg of SWEEP) expect(ratio(readableOn(bg), bg)).toBeGreaterThanOrEqual(4.5);
  });

  it('prefers the palette over pure black or white when the palette already clears AA', () => {
    expect(readableOn('#0059DE')).toBe(PAPER);
    expect(readableOn('#FFE066')).toBe(INK);
  });

  it('falls back past the palette for a mid-tone that neither ink nor paper can carry', () => {
    expect(readableOn('#0F87AF')).toBe(INK);
    expect(readableOn('#B932F0')).toBe('#000000');
  });
});

describe('contrastFloor', () => {
  it('returns a colour that already meets the target untouched', () => {
    expect(contrastFloor('#0059DE', '#FBFAF7')).toBe('#0059DE');
    expect(contrastFloor('#10B981', '#101418')).toBe('#10B981');
  });

  it('darkens against a light surface and lightens against a dark one', () => {
    for (const c of SWEEP) {
      expect(ratio(contrastFloor(c, '#FBFAF7'), '#FBFAF7')).toBeGreaterThanOrEqual(3);
      expect(ratio(contrastFloor(c, '#101418'), '#101418')).toBeGreaterThanOrEqual(3);
    }
  });

  it('moves no further than the target requires', () => {
    expect(contrastFloor('#F59E0B', '#FBFAF7')).toBe('#C98209');
  });

  it('leaves an unparseable colour alone', () => {
    expect(contrastFloor('rebeccapurple', '#FBFAF7')).toBe('rebeccapurple');
    expect(contrastFloor('#F59E0B', 'not-a-color')).toBe('#F59E0B');
  });
});
