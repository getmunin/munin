import { useCallback, useMemo } from 'react';
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

type ErrorsTranslator = ReturnType<typeof useTranslations<'errors'>>;
type RootTranslator = ReturnType<typeof useTranslations>;

export function translateError(
  err: unknown,
  tErrors: ErrorsTranslator,
  tRoot: RootTranslator,
): string {
  const code = getErrorCode(err);
  if (code) {
    try {
      const tx = tErrors(code as never);
      if (typeof tx === 'string' && tx.length > 0) return tx;
    } catch (lookupErr) {
      console.debug(`[munin/translate-error] missing i18n key "errors.${code}"`, lookupErr);
    }
  }
  if (err && typeof err === 'object' && 'message' in err) {
    const msg = (err as ErrorLike).message;
    if (typeof msg === 'string' && msg.length > 0) return msg;
  }
  if (typeof err === 'string') return err;
  try {
    return tRoot('common.unknownError' as never);
  } catch (rootErr) {
    console.warn('[munin/translate-error] common.unknownError missing', rootErr);
    return 'Unknown error.';
  }
}

export function useTranslateError() {
  const tErrors = useTranslations('errors');
  const tCommon = useTranslations('common');
  const messages = useMessages() as Record<string, unknown>;
  const knownCodes = useMemo(
    () =>
      new Set(
        messages.errors && typeof messages.errors === 'object'
          ? Object.keys(messages.errors)
          : [],
      ),
    [messages],
  );
  return useCallback(
    (err: unknown, fallbackKey?: string): string => {
      const code = getErrorCode(err);
      if (code && knownCodes.has(code)) {
        return tErrors(code as never);
      }
      if (err && typeof err === 'object' && 'message' in err) {
        const msg = (err as ErrorLike).message;
        if (typeof msg === 'string' && msg.length > 0) return msg;
      }
      if (typeof err === 'string') return err;
      return fallbackKey ? tCommon(fallbackKey as never) : tCommon('unknownError');
    },
    [tErrors, tCommon, knownCodes],
  );
}
