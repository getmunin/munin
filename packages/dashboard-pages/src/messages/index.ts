export type BaseLocale = 'en' | 'nb';

export const BASE_LOCALES: readonly BaseLocale[] = ['en', 'nb'];

export type MessagesTree = Record<string, unknown>;

export async function loadBaseMessages(locale: BaseLocale): Promise<MessagesTree> {
  switch (locale) {
    case 'en': {
      const mod = (await import('./en.json')) as { default: MessagesTree };
      return mod.default;
    }
    case 'nb': {
      const mod = (await import('./nb.json')) as { default: MessagesTree };
      return mod.default;
    }
  }
}

function isPlainObject(value: unknown): value is MessagesTree {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function mergeMessages(base: MessagesTree, overrides: MessagesTree): MessagesTree {
  const out: MessagesTree = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    const baseValue = out[key];
    if (isPlainObject(value) && isPlainObject(baseValue)) {
      out[key] = mergeMessages(baseValue, value);
    } else {
      out[key] = value;
    }
  }
  return out;
}
