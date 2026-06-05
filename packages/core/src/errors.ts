/**
 * Walk an `Error.cause` chain and produce a single-line description.
 *
 * Undici and other modern Node libraries throw a generic outer error
 * (e.g. `TypeError: fetch failed`) and stash the real reason on `.cause`.
 * This helper unwraps up to `maxDepth` levels and emits `Name[CODE]: msg`
 * for each link, joined by ` <- `.
 */
export function describeError(err: unknown, maxDepth = 4): string {
  const parts: string[] = [];
  let cur: unknown = err;
  for (let depth = 0; cur && depth < maxDepth; depth++) {
    if (cur instanceof Error) {
      const code = (cur as NodeJS.ErrnoException).code;
      parts.push(code ? `${cur.name}[${code}]: ${cur.message}` : `${cur.name}: ${cur.message}`);
      cur = (cur as { cause?: unknown }).cause;
    } else {
      parts.push(stringifyNonError(cur));
      break;
    }
  }
  return parts.join(' <- ');
}

function stringifyNonError(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return value.toString();
  if (typeof value === 'bigint') return `${value.toString()}n`;
  if (typeof value === 'symbol') return value.toString();
  try {
    return JSON.stringify(value) ?? '[unstringifiable]';
  } catch {
    return '[unstringifiable]';
  }
}
