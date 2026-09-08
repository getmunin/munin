import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const CSS = readFileSync(fileURLToPath(new URL('./tokens.css', import.meta.url)), 'utf8');

function block(marker: string): string {
  const start = CSS.indexOf(marker);
  if (start === -1) throw new Error(`tokens.css has no ${marker} block`);
  const open = CSS.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < CSS.length; i += 1) {
    if (CSS[i] === '{') depth += 1;
    if (CSS[i] === '}') {
      depth -= 1;
      if (depth === 0) return CSS.slice(open + 1, i);
    }
  }
  throw new Error(`unterminated ${marker} block`);
}

function triples(css: string): Record<string, [number, number, number]> {
  const out: Record<string, [number, number, number]> = {};
  for (const match of css.matchAll(/--munin-([a-z0-9-]+):\s*([^;]+);/g)) {
    const name = match[1];
    const value = match[2]?.trim();
    if (name === undefined || value === undefined) continue;
    const hex = /^#([0-9a-f]{6})$/i.exec(value);
    if (hex?.[1]) {
      const n = parseInt(hex[1], 16);
      out[name] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
      continue;
    }
    const rgb = /^(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})$/.exec(value);
    if (rgb) out[name] = [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  }
  return out;
}

const LIGHT = triples(block(':root'));
const DARK = { ...LIGHT, ...triples(block('@media (prefers-color-scheme: dark)')) };
const LOCKED = { ...DARK, ...triples(block('.munin-light-locked')) };

function luminance([r, g, b]: [number, number, number]): number {
  const chan = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
}

function contrast(
  palette: Record<string, [number, number, number]>,
  fg: string,
  bg: string,
): number {
  const a = palette[fg];
  const b = palette[bg];
  if (!a) throw new Error(`unknown token --munin-${fg}`);
  if (!b) throw new Error(`unknown token --munin-${bg}`);
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const LIGHT_SURFACES = ['paper', 'paper-deep', 'bone'];
const DARK_SURFACES = ['ink', 'agent-tint-on-dark'];

const TEXT_PAIRS: ReadonlyArray<
  [scheme: 'light' | 'dark' | 'locked', fg: string, backgrounds: readonly string[]]
> = [
  ['light', 'fg-1', LIGHT_SURFACES],
  ['light', 'fg-2', [...LIGHT_SURFACES, 'invite-good-bg', 'invite-bad-bg', 'verdigris-tint']],
  ['light', 'fg-3', LIGHT_SURFACES],
  ['light', 'fg-label', [...LIGHT_SURFACES, 'invite-good-bg', 'invite-bad-bg', 'alert-bad-bg']],
  ['light', 'accent', LIGHT_SURFACES],
  ['light', 'accent-deep', LIGHT_SURFACES],
  ['light', 'verdigris', ['paper', 'verdigris-tint']],
  ['light', 'alert-bad-ink', [...LIGHT_SURFACES, 'alert-bad-bg']],
  ['light', 'invite-good-ink', ['invite-good-bg']],
  ['light', 'invite-bad-ink', ['invite-bad-bg']],
  ['light', 'fg-on-dark-1', ['ink', 'auth-navy', 'auth-navy-hover']],
  ['dark', 'fg-on-dark-1', DARK_SURFACES],
  ['dark', 'fg-3', DARK_SURFACES],
  ['dark', 'fg-label', DARK_SURFACES],
  ['dark', 'accent-soft', DARK_SURFACES],
  ['dark', 'verdigris-soft', ['ink']],
  ['dark', 'alert-bad-ink', ['ink', 'alert-bad-bg']],
  ['locked', 'fg-2', LIGHT_SURFACES],
  ['locked', 'fg-3', LIGHT_SURFACES],
  ['locked', 'fg-label', [...LIGHT_SURFACES, 'invite-good-bg', 'invite-bad-bg']],
  ['locked', 'alert-bad-ink', ['paper', 'alert-bad-bg']],
];

const PALETTES = { light: LIGHT, dark: DARK, locked: LOCKED };

describe('token contrast', () => {
  for (const [scheme, fg, backgrounds] of TEXT_PAIRS) {
    for (const bg of backgrounds) {
      it(`${scheme}: ${fg} on ${bg} clears AA for normal text`, () => {
        expect(contrast(PALETTES[scheme], fg, bg)).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  it('the danger border identifies its callout on both its own tint and the page', () => {
    expect(contrast(LIGHT, 'alert-bad-border', 'alert-bad-bg')).toBeGreaterThanOrEqual(3);
    expect(contrast(LIGHT, 'alert-bad-border', 'paper')).toBeGreaterThanOrEqual(3);
    expect(contrast(DARK, 'alert-bad-border', 'alert-bad-bg')).toBeGreaterThanOrEqual(3);
    expect(contrast(DARK, 'alert-bad-border', 'ink')).toBeGreaterThanOrEqual(3);
  });

  it('the label tier reads darker than the mute tier it was split out of', () => {
    expect(contrast(LIGHT, 'fg-label', 'paper')).toBeGreaterThan(contrast(LIGHT, 'fg-3', 'paper'));
    expect(contrast(DARK, 'fg-label', 'ink')).toBeGreaterThan(contrast(DARK, 'fg-3', 'ink'));
  });

  it('a fixed-light surface keeps the light ramp when the OS asks for dark', () => {
    expect(LOCKED['fg-2']).toEqual(LIGHT['fg-2']);
    expect(LOCKED['fg-3']).toEqual(LIGHT['fg-3']);
    expect(LOCKED['fg-label']).toEqual(LIGHT['fg-label']);
    expect(LOCKED['alert-bad-ink']).toEqual(LIGHT['alert-bad-ink']);
  });

  it('identity hues carry a per-scheme lightness rather than one value for both', () => {
    const lightness = (css: string) => /--munin-participant-l:\s*([\d.]+)/.exec(css)?.[1];
    expect(lightness(block(':root'))).toBe('0.5');
    expect(lightness(block('@media (prefers-color-scheme: dark)'))).toBe('0.74');
    expect(lightness(block('.munin-light-locked'))).toBe('0.5');
  });
});
