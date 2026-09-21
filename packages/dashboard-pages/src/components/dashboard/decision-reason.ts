const CODE_PREFIX = /^([a-z][a-z0-9]*(?:_[a-z0-9]+)+):[ \t]*/;

export interface DecisionReason {
  code: string | null;
  message: string;
}

export function splitDecisionReason(reason: string | null | undefined): DecisionReason | null {
  const trimmed = reason?.trim() ?? '';
  if (trimmed.length === 0) return null;

  const match = CODE_PREFIX.exec(trimmed);
  if (!match) return { code: null, message: trimmed };

  const message = trimmed.slice(match[0].length).trim();
  if (message.length === 0) return { code: null, message: trimmed };
  return { code: match[1] ?? null, message };
}
