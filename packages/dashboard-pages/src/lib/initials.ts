export function initialsOf(name: string | null | undefined, fallback = '?'): string {
  const src = name?.trim() || fallback;
  const parts = src.split(/[\s@._-]+/).filter(Boolean);
  const two = `${parts[0]?.[0] ?? ''}${parts[1]?.[0] ?? ''}`;
  return (two || src.slice(0, 2)).toUpperCase();
}
