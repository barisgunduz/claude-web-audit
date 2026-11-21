import { loadPage } from '../../crawler/dom.js';
import { bareHost, resolveUrl } from '../../crawler/url.js';
import type { PageRecord } from '../../model/crawl.js';

export const MAX_ASSETS = 30;
/** Small files gain nothing from compression. */
export const MIN_COMPRESSIBLE_BYTES = 1024;
/** Lighthouse ignores assets that are cached for 30 days or more (trace_engine Cache insight). */
export const LONG_CACHE_SECONDS = 30 * 24 * 60 * 60;

const TEXT_TYPES = [
  /^text\//,
  /^application\/(javascript|x-javascript|json|ld\+json|manifest\+json|xml|xhtml\+xml|rss\+xml|atom\+xml)/,
  /^image\/svg\+xml/,
  /^font\/(ttf|otf)/,
  /^application\/(x-font-ttf|x-font-opentype|vnd\.ms-fontobject)/,
];
const COMPRESSED_ENCODINGS = new Set(['br', 'gzip', 'zstd', 'deflate']);

/** True for types that gain from compression. Images and woff fonts are already compressed. */
export function isCompressibleType(contentType: string): boolean {
  const type = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  return TEXT_TYPES.some((pattern) => pattern.test(type));
}

export function isCompressed(contentEncoding: string | undefined): boolean {
  if (contentEncoding === undefined) return false;
  return contentEncoding
    .toLowerCase()
    .split(',')
    .some((encoding) => COMPRESSED_ENCODINGS.has(encoding.trim()));
}

export interface CachePolicy {
  /** Lifetime in seconds, from max-age or Expires. Undefined when neither is set. */
  ttl: number | undefined;
  noStore: boolean;
  noCache: boolean;
  hasValidator: boolean;
  hasAnyHeader: boolean;
}

export function parseCachePolicy(
  headers: Readonly<Record<string, string>>,
  now: Date,
): CachePolicy {
  const control = (headers['cache-control'] ?? '').toLowerCase();
  const directives = control.split(',').map((part) => part.trim());
  const maxAge = /(?:^|,)\s*(?:max-age|s-maxage)\s*=\s*(\d+)/.exec(control)?.[1];
  const expires = headers.expires;
  let ttl: number | undefined = maxAge === undefined ? undefined : Number(maxAge);
  if (ttl === undefined && expires !== undefined) {
    const date = Date.parse(expires);
    ttl = Number.isNaN(date) ? 0 : Math.max(0, Math.ceil((date - now.getTime()) / 1000));
  }
  return {
    ttl,
    noStore: directives.includes('no-store'),
    noCache: directives.includes('no-cache'),
    hasValidator: headers.etag !== undefined || headers['last-modified'] !== undefined,
    hasAnyHeader:
      control !== '' ||
      expires !== undefined ||
      headers.etag !== undefined ||
      headers['last-modified'] !== undefined,
  };
}

/** A hash in the file name, or a version in the query string, means the URL changes with the content. */
export function isVersionedUrl(url: string): boolean {
  const parsed = new URL(url);
  const file = parsed.pathname.split('/').pop() ?? '';
  return (
    /[.-][0-9a-f]{8,}\b/i.test(file) ||
    /(?:^|&)(?:ver|v|version|rev|hash)=/i.test(parsed.search.slice(1))
  );
}

/** Same-site static assets that the pages refer to: scripts, then stylesheets, preloads and images, without repeats. */
export function extractAssetUrls(
  pages: readonly PageRecord[],
  canonicalHost: string,
  limit = MAX_ASSETS,
): string[] {
  const site = bareHost(canonicalHost);
  const found = new Set<string>();
  const selectors: readonly (readonly [string, string])[] = [
    ['script[src]', 'src'],
    ['link[rel~="stylesheet"][href]', 'href'],
    ['link[rel="preload"][href]', 'href'],
    ['img[src]', 'src'],
  ];
  for (const page of pages) {
    const $ = loadPage(page);
    if (!$) continue;
    for (const [selector, attribute] of selectors) {
      for (const element of $(selector).toArray()) {
        const absolute = resolveUrl($(element).attr(attribute) ?? '', page.finalUrl);
        if (absolute !== undefined && bareHost(new URL(absolute).hostname) === site)
          found.add(absolute);
        if (found.size >= limit) return [...found];
      }
    }
  }
  return [...found];
}
