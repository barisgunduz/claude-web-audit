import type { CheerioAPI } from 'cheerio';

export const SHINGLE_SIZE = 5;
/** Two pages with at least this share of identical 5-word sequences are near duplicates. */
export const SIMILARITY_THRESHOLD = 0.85;
/** Pages shorter than this are left out of the near-duplicate comparison. */
export const MIN_WORDS_FOR_COMPARISON = 100;

/** Main text of a page without navigation, header, footer, scripts and styles. */
export function mainText($: CheerioAPI): string {
  const root = $('main').length > 0 ? $('main').first() : $('body');
  const copy = root.clone();
  copy.find('script, style, noscript, template, svg, nav, header, footer, aside, form').remove();
  return copy.text().replace(/\s+/g, ' ').trim();
}

export function words(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];
}

function hash(text: string): number {
  let value = 2166136261;
  for (let index = 0; index < text.length; index++) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

export function shingles(wordList: readonly string[]): Set<number> {
  const result = new Set<number>();
  for (let index = 0; index + SHINGLE_SIZE <= wordList.length; index++) {
    result.add(hash(wordList.slice(index, index + SHINGLE_SIZE).join(' ')));
  }
  return result;
}

/** Share of shared shingles among all shingles of both sets. */
export function jaccard(a: ReadonlySet<number>, b: ReadonlySet<number>): number {
  if (a.size === 0 || b.size === 0) return 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let shared = 0;
  for (const value of small) if (large.has(value)) shared++;
  return shared / (a.size + b.size - shared);
}
