import { loadPage } from '../../crawler/dom.js';
import { resolveUrl } from '../../crawler/url.js';
import type { PageRecord } from '../../model/crawl.js';
import { stripTrailingSlash } from '../../checks/support.js';

export function robotsDirectives(page: PageRecord): string[] {
  const $ = loadPage(page);
  const values: string[] = [page.headers['x-robots-tag'] ?? ''];
  if ($) {
    $('meta[name]').each((_, element) => {
      const name = ($(element).attr('name') ?? '').toLowerCase();
      if (name === 'robots' || name === 'googlebot') values.push($(element).attr('content') ?? '');
    });
  }
  return values
    .join(',')
    .toLowerCase()
    .split(/[,\s]+/)
    .filter((value) => value !== '');
}

export function isNoindex(page: PageRecord): boolean {
  const directives = robotsDirectives(page);
  return directives.includes('noindex') || directives.includes('none');
}

export interface CanonicalInfo {
  /** Every rel=canonical href on the page, as written. */
  raw: string[];
  /** The first one, resolved to an absolute URL. */
  resolved?: string;
}

export function canonicalOf(page: PageRecord): CanonicalInfo {
  const $ = loadPage(page);
  if (!$) return { raw: [] };
  const raw = $('link[rel~="canonical"][href]')
    .map((_, element) => $(element).attr('href') ?? '')
    .get()
    .filter((href) => href.trim() !== '');
  const first = raw[0];
  const resolved = first === undefined ? undefined : resolveUrl(first.trim(), page.finalUrl);
  return { raw, ...(resolved !== undefined && { resolved }) };
}

/** Compares URLs while ignoring a trailing slash and the fragment. */
export function sameUrl(a: string, b: string): boolean {
  return stripTrailingSlash(a.split('#')[0] ?? a) === stripTrailingSlash(b.split('#')[0] ?? b);
}
