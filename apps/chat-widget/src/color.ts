export const INK = '#0F1419';
export const PAPER = '#FBFAF7';

const BLACK = '#000000';
const WHITE = '#FFFFFF';
const AA_TEXT = 4.5;
const STEPS = 200;

type Rgb = [number, number, number];

export function readableOn(background: string): string {
  const bg = luminance(background);
  if (bg === null) return PAPER;
  const onInk = contrastRatio(bg, luminance(INK)!);
  const onPaper = contrastRatio(bg, luminance(PAPER)!);
  if (onInk >= AA_TEXT || onPaper >= AA_TEXT) return onInk > onPaper ? INK : PAPER;
  return contrastRatio(bg, 0) >= contrastRatio(bg, 1) ? BLACK : WHITE;
}

export function contrastFloor(color: string, on: string, target = 3): string {
  const fg = parseHex(color);
  const bgRgb = parseHex(on);
  if (fg === null || bgRgb === null) return color;
  const bg = relativeLuminance(bgRgb);
  if (contrastRatio(bg, relativeLuminance(fg)) >= target) return color;

  const toward = contrastRatio(bg, 0) >= contrastRatio(bg, 1) ? 0 : 255;
  for (let step = 1; step <= STEPS; step += 1) {
    const moved = fg.map((c) => Math.round(c + (toward - c) * (step / STEPS))) as Rgb;
    if (contrastRatio(bg, relativeLuminance(moved)) >= target) return toHex(moved);
  }
  return toward === 0 ? BLACK : WHITE;
}

function luminance(hex: string): number | null {
  const rgb = parseHex(hex);
  if (!rgb) return null;
  return relativeLuminance(rgb);
}

function relativeLuminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  }) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a: number, b: number): number {
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

function toHex(rgb: Rgb): string {
  return (
    '#' +
    rgb
      .map((c) =>
        Math.max(0, Math.min(255, Math.round(c)))
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
      .toUpperCase()
  );
}

function parseHex(hex: string): Rgb | null {
  const raw = hex.trim().replace(/^#/, '');
  const full =
    raw.length === 3 || raw.length === 4
      ? raw
          .slice(0, 3)
          .split('')
          .map((c) => c + c)
          .join('')
      : raw.length === 6 || raw.length === 8
        ? raw.slice(0, 6)
        : null;
  if (full === null || !/^[0-9a-f]{6}$/i.test(full)) return null;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}
