export const BOT_UA = /\b(bot|crawler|spider|preview|linkcheck|monitor)\b/i;

export function looksLikeBot(userAgent: string | undefined | null): boolean {
  if (!userAgent) return false;
  return BOT_UA.test(userAgent);
}
