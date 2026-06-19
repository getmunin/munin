export function asRecord(json: unknown): Record<string, unknown> {
  return typeof json === 'object' && json !== null && !Array.isArray(json)
    ? (json as Record<string, unknown>)
    : {};
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function toRows(json: unknown, ...keys: string[]): Record<string, unknown>[] {
  const raw = Array.isArray(json)
    ? json
    : keys.map((k) => asRecord(json)[k]).find((v) => Array.isArray(v));
  return asArray(raw).filter(
    (r): r is Record<string, unknown> => typeof r === 'object' && r !== null,
  );
}
