export const INK = '#0F1419';
export const PAPER = '#FBFAF7';

export function readableOn(background: string): string {
  const bg = luminance(background);
  if (bg === null) return PAPER;
  return contrastRatio(bg, luminance(INK)!) > contrastRatio(bg, luminance(PAPER)!) ? INK : PAPER;
}

function luminance(hex: string): number | null {
  const rgb = parseHex(hex);
  if (!rgb) return null;
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a: number, b: number): number {
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

function parseHex(hex: string): [number, number, number] | null {
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
