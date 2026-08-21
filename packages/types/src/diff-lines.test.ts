import { describe, expect, it } from 'vitest';
import { diffLines, hasChanges } from './diff-lines.ts';

function render(before: string, after: string): string[] {
  return diffLines(before, after).map((l) => `${l.op === 'context' ? ' ' : l.op === 'added' ? '+' : '-'}${l.text}`);
}

describe('diffLines', () => {
  it('reports no changes for identical text', () => {
    const lines = diffLines('a\nb', 'a\nb');
    expect(hasChanges(lines)).toBe(false);
    expect(lines.every((l) => l.op === 'context')).toBe(true);
  });

  it('keeps surrounding lines as context around a changed one', () => {
    expect(render('intro\nrate is 11.9%\noutro', 'intro\nrate is 9.4%\noutro')).toEqual([
      ' intro',
      '-rate is 11.9%',
      '+rate is 9.4%',
      ' outro',
    ]);
  });

  it('marks a pure insertion without touching the kept lines', () => {
    expect(render('a\nc', 'a\nb\nc')).toEqual([' a', '+b', ' c']);
  });

  it('marks a pure deletion', () => {
    expect(render('a\nb\nc', 'a\nc')).toEqual([' a', '-b', ' c']);
  });

  it('normalises CRLF so a line-ending change is not a diff', () => {
    expect(hasChanges(diffLines('a\r\nb', 'a\nb'))).toBe(false);
  });

  it('treats a body replaced wholesale as all-removed then all-added', () => {
    expect(render('old', 'new')).toEqual(['-old', '+new']);
  });

  it('falls back to a block replace instead of a quadratic diff on huge bodies', () => {
    const before = Array.from({ length: 2001 }, (_, i) => `line ${i}`).join('\n');
    const lines = diffLines(before, 'short');
    expect(lines.filter((l) => l.op === 'context')).toEqual([]);
    expect(lines.at(-1)).toEqual({ op: 'added', text: 'short' });
  });
});
