export const MUNIN_LOGO_SRC = '/munin-logo.png';

export function logoDarkClass(src: string): string | undefined {
  return src === MUNIN_LOGO_SRC ? 'dark:invert' : undefined;
}
