import { cn } from '@getmunin/ui';

type MetaGlyph = '→' | '↗' | '↓' | '↑' | '⟳' | '↔';

const GLYPH_PATHS: Record<MetaGlyph, string[]> = {
  '→': ['M4 12h16', 'm13 5 7 7-7 7'],
  '↗': ['M6 18 18 6', 'M8 6h10v10'],
  '↓': ['M12 4v16', 'm5 13 7 7 7-7'],
  '↑': ['M12 20V4', 'm5 11 7-7 7 7'],
  '⟳': ['M21 12a9 9 0 1 1-3-6.7L21 8', 'M21 3v5h-5'],
  '↔': ['M3 12h18', 'm8 7-5 5 5 5', 'm16 7 5 5-5 5'],
};

export function MetaArrow({
  glyph = '→',
  className,
}: {
  glyph?: MetaGlyph;
  className?: string;
}) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.25}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn('size-[12px] shrink-0', className)}
    >
      {GLYPH_PATHS[glyph].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
