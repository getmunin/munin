export const BOT_UA = /(bot|crawler|spider|preview|linkcheck|monitor)\b/i;

export const DEVICE_NAMES_ENDING_IN_A_BOT_TOKEN = /cubot/gi;

export function looksLikeBot(userAgent: string | undefined | null): boolean {
  if (!userAgent) return false;
  return BOT_UA.test(userAgent.replace(DEVICE_NAMES_ENDING_IN_A_BOT_TOKEN, ''));
}
