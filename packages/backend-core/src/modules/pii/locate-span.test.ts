import { describe, expect, it } from 'vitest';
import { locateSpan } from './pii-annotations.service.ts';

describe('locateSpan', () => {
  it('keeps offsets that already point at the surface', () => {
    expect(locateSpan('Hei Per Olsen', { start: 4, end: 13, text: 'Per Olsen' })).toEqual({ start: 4, end: 13 });
  });

  it('re-anchors code-point offsets from Python onto UTF-16 offsets', () => {
    const body = '🙂 Takk, Lise!';
    expect(locateSpan(body, { start: 8, end: 12, text: 'Lise' })).toEqual({ start: 9, end: 13 });
  });

  it('picks the occurrence nearest the reported offset', () => {
    const body = 'Lise ringte. Hilsen Lise';
    expect(locateSpan(body, { start: 19, end: 23, text: 'Lise' })).toEqual({ start: 20, end: 24 });
  });

  it('drops a surface the body does not contain', () => {
    expect(locateSpan('Hei', { start: 0, end: 3, text: 'Nobody' })).toBeNull();
  });

  it('drops blank and oversized surfaces', () => {
    expect(locateSpan('   ', { start: 0, end: 3, text: '   ' })).toBeNull();
    expect(locateSpan('x'.repeat(200), { start: 0, end: 200, text: 'x'.repeat(200) })).toBeNull();
  });
});
