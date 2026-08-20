'use client';

export function ClientGlyph({ iconUrl, name }: { iconUrl: string | null; name: string }) {
  const glyph = (name.trim()[0] ?? '?').toUpperCase();
  return (
    <span className="flex size-[18px] shrink-0 items-center justify-center overflow-hidden rounded-[4px] border-[1px] border-rule-soft bg-white font-serif text-[10px] leading-none text-ink dark:border-rule-on-dark">
      {iconUrl ? (
        <img
          src={iconUrl}
          alt=""
          className="size-3 object-contain"
          onError={(e) => {
            e.currentTarget.style.display = 'none';
          }}
        />
      ) : (
        glyph
      )}
    </span>
  );
}
