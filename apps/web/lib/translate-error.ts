import { useMessages, useTranslations } from 'next-intl';

interface ErrorLike {
  code?: string | null;
  message?: string | null;
}

export function getErrorCode(err: unknown): string | null {
  if (err && typeof err === 'object') {
    const e = err as { code?: unknown; body?: { code?: unknown }; cause?: { code?: unknown } };
    if (typeof e.code === 'string') return e.code;
    if (e.body && typeof e.body === 'object' && typeof e.body.code === 'string') return e.body.code;
    if (e.cause && typeof e.cause === 'object' && typeof e.cause.code === 'string') return e.cause.code;
  }
  return null;
}

export function useTranslateError() {
  const t = useTranslations('errors');
  const common = useTranslations('common');
  const messages = useMessages() as Record<string, unknown>;
  const knownCodes = new Set(
    messages.errors && typeof messages.errors === 'object'
      ? Object.keys(messages.errors)
      : [],
  );
  return (err: unknown, fallbackKey?: string): string => {
    const code = getErrorCode(err);
    if (code && knownCodes.has(code)) {
      return t(code as never);
    }
    if (err && typeof err === 'object' && 'message' in err) {
      const msg = (err as ErrorLike).message;
      if (typeof msg === 'string' && msg.length > 0) return msg;
    }
    if (typeof err === 'string') return err;
    return fallbackKey ? common(fallbackKey as never) : common('unknownError');
  };
}
