import { gunzipSync } from 'node:zlib';
import * as cheerio from 'cheerio';
import type { SitemapData, SitemapFile, SitemapUrl } from '../model/crawl.js';
import type { HttpClient } from './http.js';
import { traceUrl } from './trace.js';

export const SITEMAP_MAX_BYTES = 50 * 1024 * 1024;
export const SITEMAP_MAX_URLS = 50_000;
const MAX_FILES = 25;
const MAX_TOTAL_URLS = 100_000;

function isGzip(bytes: Uint8Array): boolean {
  return bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

export interface ParsedSitemap {
  kind: 'urlset' | 'index' | 'invalid';
  entries: { loc: string; lastmod?: string }[];
  error?: string;
}

/** Parses the XML of one sitemap or sitemap index. */
export function parseSitemapXml(xml: string): ParsedSitemap {
  const trimmed = xml.replace(/^\uFEFF/, '').trim();
  if (!/^(<\?xml[^>]*\?>\s*)?(<!--[\s\S]*?-->\s*)*<(urlset|sitemapindex)[\s>]/i.test(trimmed)) {
    return { kind: 'invalid', entries: [], error: 'Root element is not urlset or sitemapindex' };
  }
  const $ = cheerio.load(trimmed, { xmlMode: true });
  const isIndex = $('sitemapindex').length > 0;
  const entries: { loc: string; lastmod?: string }[] = [];
  $(isIndex ? 'sitemap' : 'url').each((_, node) => {
    const loc = $(node).children('loc').first().text().trim();
    if (loc === '') return;
    const lastmod = $(node).children('lastmod').first().text().trim();
    entries.push({ loc, ...(lastmod !== '' && { lastmod }) });
  });
  return { kind: isIndex ? 'index' : 'urlset', entries };
}

/** Reads sitemap files and sitemap indexes (plain or gzip). A broken file is recorded, never thrown. */
export async function readSitemaps(
  http: HttpClient,
  startUrls: readonly string[],
): Promise<SitemapData> {
  const files: SitemapFile[] = [];
  const urls: SitemapUrl[] = [];
  const queue = [...startUrls];
  const seen = new Set(queue);

  while (queue.length > 0 && files.length < MAX_FILES) {
    const url = queue.shift();
    if (url === undefined) break;
    const { trace, response } = await traceUrl(http, url, {
      body: 'bytes',
      maxBytes: SITEMAP_MAX_BYTES + 1,
    });
    if (!response || trace.status !== 200) {
      files.push({
        url,
        status: trace.status,
        kind: 'missing',
        gzip: false,
        bytes: 0,
        urlCount: 0,
        ...(trace.error !== undefined && { error: trace.error }),
      });
      continue;
    }

    let bytes: Uint8Array = response.bytes;
    const gzip = isGzip(bytes);
    if (gzip) {
      try {
        bytes = gunzipSync(bytes, { maxOutputLength: SITEMAP_MAX_BYTES + 1 });
      } catch {
        files.push({
          url,
          status: 200,
          kind: 'invalid',
          gzip,
          bytes: 0,
          urlCount: 0,
          error: 'Cannot decompress',
        });
        continue;
      }
    }
    const parsed = parseSitemapXml(new TextDecoder('utf-8').decode(bytes));
    files.push({
      url,
      status: 200,
      kind: parsed.kind,
      gzip,
      bytes: bytes.length,
      urlCount: parsed.kind === 'urlset' ? parsed.entries.length : 0,
      ...(parsed.error !== undefined && { error: parsed.error }),
    });

    if (parsed.kind === 'index') {
      for (const entry of parsed.entries) {
        if (!seen.has(entry.loc)) {
          seen.add(entry.loc);
          queue.push(entry.loc);
        }
      }
    } else if (parsed.kind === 'urlset') {
      for (const entry of parsed.entries) {
        if (urls.length >= MAX_TOTAL_URLS) break;
        urls.push({
          loc: entry.loc,
          sitemap: url,
          ...(entry.lastmod !== undefined && { lastmod: entry.lastmod }),
        });
      }
    }
  }
  return { files, urls, truncated: false };
}
