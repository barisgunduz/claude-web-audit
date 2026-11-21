import en from './en.json' with { type: 'json' };
import tr from './tr.json' with { type: 'json' };

export type MessageKey = keyof typeof en;
export type Dictionary = Partial<Record<MessageKey, string>>;
export type Translate = (key: MessageKey) => string;

export const DICTIONARIES: Readonly<Record<string, Dictionary>> = { en, tr };

function findDictionary(
  dictionaries: Readonly<Record<string, Dictionary>>,
  lang: string,
): Dictionary {
  const code = lang.toLowerCase();
  const base = code.split('-')[0] ?? code;
  for (const candidate of [code, base]) {
    const found = Object.hasOwn(dictionaries, candidate) ? dictionaries[candidate] : undefined;
    if (found) return found;
  }
  return {};
}

/** Returns a lookup that falls back to English, then to the key itself. */
export function createTranslator(
  lang: string,
  dictionaries: Readonly<Record<string, Dictionary>> = DICTIONARIES,
): Translate {
  const selected = findDictionary(dictionaries, lang);
  const fallback = findDictionary(dictionaries, 'en');
  return (key) => selected[key] ?? fallback[key] ?? key;
}
